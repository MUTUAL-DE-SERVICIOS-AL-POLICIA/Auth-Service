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
  refresh_expires_in?: number;
}

export class OidcError extends Error {
  constructor(
    readonly kind:
      'invalid_grant' | 'unavailable' | 'invalid_response' = 'unavailable',
  ) {
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
      throw new OidcError('invalid_response');
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
      throw new OidcError('invalid_response');
    }
  }

  private async tokenRequest(
    url: string,
    body: URLSearchParams,
  ): Promise<OidcTokenResponse> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      throw new OidcError('unavailable');
    }
    if (!response.ok) {
      let errorCode: unknown;
      try {
        const error = (await response.json()) as Record<string, unknown>;
        errorCode = error.error;
      } catch {
        // The public error deliberately does not include the response body.
      }
      if (response.status === 400 && errorCode === 'invalid_grant')
        throw new OidcError('invalid_grant');
      throw new OidcError(
        response.status >= 500 ? 'unavailable' : 'invalid_response',
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new OidcError('invalid_response');
    }
    if (!data || typeof data !== 'object')
      throw new OidcError('invalid_response');
    const value = data as Record<string, unknown>;
    if (
      typeof value.access_token !== 'string' ||
      !value.access_token ||
      value.token_type !== 'Bearer' ||
      typeof value.expires_in !== 'number' ||
      value.expires_in <= 0 ||
      (value.refresh_token !== undefined &&
        (typeof value.refresh_token !== 'string' || !value.refresh_token)) ||
      (value.id_token !== undefined &&
        (typeof value.id_token !== 'string' || !value.id_token)) ||
      (value.refresh_expires_in !== undefined &&
        (typeof value.refresh_expires_in !== 'number' ||
          value.refresh_expires_in <= 0))
    )
      throw new OidcError('invalid_response');
    return value as unknown as OidcTokenResponse;
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
      throw new OidcError('invalid_response');
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
    return this.tokenRequest(this.networkUrl(metadata.token_endpoint), body);
  }

  async refreshPrimaryToken(refreshToken: string): Promise<OidcTokenResponse> {
    const metadata = await this.discovery();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.hubClientId,
      refresh_token: refreshToken,
    });
    if (this.config.hubClientType === 'confidential')
      body.set('client_secret', this.config.hubClientSecret!);
    return this.tokenRequest(this.networkUrl(metadata.token_endpoint), body);
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
      throw new OidcError('invalid_response');
    }
  }

  async validateAccessToken(token: string): Promise<JWTPayload> {
    const payload = await this.verify(token);
    const aud = payload.aud;
    const audienceMatches =
      aud === this.config.hubClientId ||
      (Array.isArray(aud) && aud.includes(this.config.hubClientId));
    if (!audienceMatches && payload.azp !== this.config.hubClientId)
      throw new OidcError('invalid_response');
    if (payload.azp !== undefined && payload.azp !== this.config.hubClientId)
      throw new OidcError('invalid_response');
    return payload;
  }

  async validateIdToken(token: string, nonce: string): Promise<JWTPayload> {
    const payload = await this.verify(token);
    const aud = payload.aud;
    if (
      aud !== this.config.hubClientId &&
      !(Array.isArray(aud) && aud.includes(this.config.hubClientId))
    )
      throw new OidcError('invalid_response');
    if (payload.azp !== undefined && payload.azp !== this.config.hubClientId)
      throw new OidcError('invalid_response');
    if (typeof payload.nonce !== 'string')
      throw new OidcError('invalid_response');
    const actual = Buffer.from(payload.nonce);
    const expected = Buffer.from(nonce);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new OidcError('invalid_response');
    return payload;
  }

  async validateRefreshedIdToken(token: string): Promise<JWTPayload> {
    const payload = await this.verify(token);
    const aud = payload.aud;
    if (
      aud !== this.config.hubClientId &&
      !(Array.isArray(aud) && aud.includes(this.config.hubClientId))
    )
      throw new OidcError('invalid_response');
    if (payload.azp !== undefined && payload.azp !== this.config.hubClientId)
      throw new OidcError('invalid_response');
    return payload;
  }
}
