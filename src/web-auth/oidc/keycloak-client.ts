import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import { WebAuthConfig } from '../web-auth.config';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface OidcTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
}

export class OidcError extends Error {
  constructor() {
    super('OIDC operation failed');
  }
}

@Injectable()
export class KeycloakClient {
  private discoveryCache?: { value: Discovery; expiresAt: number };
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private jwksUri?: string;

  constructor(private readonly config: WebAuthConfig) {}

  private networkUrl(publicUrl: string): string {
    const url = new URL(publicUrl);
    const issuer = new URL(this.config.issuer);
    if (
      url.origin !== issuer.origin ||
      !url.pathname.startsWith(`${issuer.pathname}/`)
    )
      throw new OidcError();
    if (!this.config.internalBaseUrl) return url.toString();
    const internal = new URL(this.config.internalBaseUrl);
    return new URL(url.pathname + url.search, internal).toString();
  }

  private async fetchJson(url: string, init?: RequestInit): Promise<unknown> {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new OidcError();
      return await response.json();
    } catch {
      throw new OidcError();
    }
  }

  async discovery(): Promise<Discovery> {
    if (this.discoveryCache && this.discoveryCache.expiresAt > Date.now())
      return this.discoveryCache.value;
    const url = `${this.config.issuer}/.well-known/openid-configuration`;
    const data = await this.fetchJson(this.networkUrl(url));
    if (!data || typeof data !== 'object') throw new OidcError();
    const value = data as Record<string, unknown>;
    if (
      value.issuer !== this.config.issuer ||
      typeof value.authorization_endpoint !== 'string' ||
      typeof value.token_endpoint !== 'string' ||
      typeof value.jwks_uri !== 'string'
    )
      throw new OidcError();
    for (const endpoint of [
      value.authorization_endpoint,
      value.token_endpoint,
      value.jwks_uri,
    ]) {
      this.networkUrl(endpoint);
    }
    const metadata = value as unknown as Discovery;
    this.discoveryCache = { value: metadata, expiresAt: Date.now() + 300_000 };
    return metadata;
  }

  async authorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<string> {
    const metadata = await this.discovery();
    const url = new URL(metadata.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.hubClientId);
    url.searchParams.set('redirect_uri', this.config.callbackUrl);
    url.searchParams.set('scope', 'openid');
    url.searchParams.set('state', input.state);
    url.searchParams.set('nonce', input.nonce);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeAuthorizationCode(
    code: string,
    verifier: string,
  ): Promise<OidcTokenResponse> {
    const metadata = await this.discovery();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.hubClientId,
      redirect_uri: this.config.callbackUrl,
      code,
      code_verifier: verifier,
    });
    if (this.config.hubClientType === 'confidential')
      body.set('client_secret', this.config.hubClientSecret!);
    const data = await this.fetchJson(
      this.networkUrl(metadata.token_endpoint),
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    if (!data || typeof data !== 'object') throw new OidcError();
    const value = data as Record<string, unknown>;
    if (
      typeof value.access_token !== 'string' ||
      !value.access_token ||
      value.token_type !== 'Bearer' ||
      typeof value.expires_in !== 'number' ||
      value.expires_in <= 0 ||
      (value.refresh_token !== undefined &&
        typeof value.refresh_token !== 'string') ||
      (value.id_token !== undefined && typeof value.id_token !== 'string')
    )
      throw new OidcError();
    return value as unknown as OidcTokenResponse;
  }

  private async signingKeys(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    const metadata = await this.discovery();
    const uri = this.networkUrl(metadata.jwks_uri);
    if (!this.jwks || this.jwksUri !== uri) {
      this.jwks = createRemoteJWKSet(new URL(uri), {
        timeoutDuration: 3000,
        cooldownDuration: 30_000,
        cacheMaxAge: 300_000,
      });
      this.jwksUri = uri;
    }
    return this.jwks;
  }

  private async verify(token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, await this.signingKeys(), {
        issuer: this.config.issuer,
        algorithms: ['RS256'],
      });
      if (!payload.sub || !Number.isFinite(payload.exp)) throw new OidcError();
      return payload;
    } catch {
      throw new OidcError();
    }
  }

  async validateAccessToken(token: string): Promise<JWTPayload> {
    const payload = await this.verify(token);
    const aud = payload.aud;
    const audienceMatches =
      aud === this.config.hubClientId ||
      (Array.isArray(aud) && aud.includes(this.config.hubClientId));
    if (!audienceMatches && payload.azp !== this.config.hubClientId)
      throw new OidcError();
    if (payload.azp !== undefined && payload.azp !== this.config.hubClientId)
      throw new OidcError();
    return payload;
  }

  async validateIdToken(token: string, nonce: string): Promise<JWTPayload> {
    const payload = await this.verify(token);
    const aud = payload.aud;
    if (
      aud !== this.config.hubClientId &&
      !(Array.isArray(aud) && aud.includes(this.config.hubClientId))
    )
      throw new OidcError();
    if (payload.azp !== undefined && payload.azp !== this.config.hubClientId)
      throw new OidcError();
    if (typeof payload.nonce !== 'string') throw new OidcError();
    const actual = Buffer.from(payload.nonce);
    const expected = Buffer.from(nonce);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new OidcError();
    return payload;
  }
}
