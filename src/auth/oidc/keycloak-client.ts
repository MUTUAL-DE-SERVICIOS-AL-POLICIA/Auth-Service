import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import { AuthConfig } from '../config/auth.config';
import { ClientCatalogEntry } from '../config/client-catalog';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
}

export interface OidcTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  refresh_expires_in?: number;
}

export interface ExchangeWebClientTokenRequest {
  subjectToken: string;
  expectedSubject: string;
  target: Readonly<ClientCatalogEntry>;
}

export interface ExchangedWebClientClaims {
  subject: string;
  issuer: string;
  audience: readonly string[];
  azp?: string;
  sid?: string;
  realmRoles: readonly string[];
  clientRoles: readonly string[];
  groups: readonly string[];
  expiresAt: number;
}

export interface ExchangedWebClientToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  expiresAt: number;
  refreshToken?: string;
  refreshExpiresIn?: number;
  idToken?: string;
  issuedTokenType?: 'urn:ietf:params:oauth:token-type:access_token';
  scope?: string;
  claims: ExchangedWebClientClaims;
}

export interface UmaDecisionRequest {
  accessToken: string;
  target: Readonly<ClientCatalogEntry>;
  resource: string;
  scope: string;
}

export interface BackchannelLogoutClaims {
  sid?: string;
  sub?: string;
}

const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const UMA_TICKET_GRANT = 'urn:ietf:params:oauth:grant-type:uma-ticket';
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;
const UMA_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UMA_DENIAL_ERRORS = new Set(['access_denied']);
const OAUTH_ERROR_VALUE_MAX_LENGTH = 2048;

export class OidcError extends Error {
  constructor(
    readonly kind:
      | 'invalid_configuration'
      | 'invalid_target'
      | 'unauthorized_client'
      | 'access_denied'
      | 'invalid_grant'
      | 'unavailable'
      | 'invalid_response'
      | 'invalid_token' = 'unavailable',
  ) {
    super('OIDC operation failed');
  }
}

@Injectable()
export class KeycloakClient {
  private discoveryCache?: { value: Discovery; expiresAt: number };
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  private jwksUri?: string;

  constructor(private readonly config: AuthConfig) {}

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

  private async boundedJson(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') || '';
    const mediaType = contentType
      .split(';', 1)[0]
      .replace(/^[ \t]+|[ \t]+$/g, '');
    const contentLength = Number(response.headers.get('content-length'));
    if (
      mediaType.toLowerCase() !== 'application/json' ||
      (Number.isFinite(contentLength) &&
        contentLength > MAX_TOKEN_RESPONSE_BYTES)
    ) {
      throw new OidcError('invalid_response');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new OidcError('invalid_response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_TOKEN_RESPONSE_BYTES) {
          await reader.cancel();
          throw new OidcError('invalid_response');
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      if (error instanceof OidcError) throw error;
      throw new OidcError('invalid_response');
    }
  }

  private async tokenEndpointRequest(
    url: string,
    body: URLSearchParams,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        let errorCode: unknown;
        try {
          const error = await this.boundedJson(response);
          if (error && typeof error === 'object')
            errorCode = (error as Record<string, unknown>).error;
        } catch {
          // The public error deliberately does not include the response body.
        }
        if (
          errorCode === 'invalid_grant' ||
          errorCode === 'invalid_target' ||
          errorCode === 'unauthorized_client' ||
          errorCode === 'access_denied'
        ) {
          throw new OidcError(errorCode);
        }
        throw new OidcError(
          response.status >= 500 ? 'unavailable' : 'invalid_response',
        );
      }
      const data = await this.boundedJson(response);
      if (!data || Array.isArray(data) || typeof data !== 'object')
        throw new OidcError('invalid_response');
      return data as Record<string, unknown>;
    } catch (error) {
      if (controller.signal.aborted) throw new OidcError('unavailable');
      if (error instanceof OidcError) throw error;
      throw new OidcError('unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseTokenResponse(
    value: Record<string, unknown>,
  ): OidcTokenResponse {
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

  private normalizeClaimList(value: unknown): readonly string[] {
    if (value === undefined) return Object.freeze([]);
    if (!Array.isArray(value)) throw new OidcError('invalid_token');
    const normalized = value.map((item) => {
      if (typeof item !== 'string') throw new OidcError('invalid_token');
      return item.trim();
    });
    return Object.freeze([...new Set(normalized.filter(Boolean))]);
  }

  private readAudience(value: unknown): readonly string[] {
    if (value === undefined) return Object.freeze([]);
    const audiences = typeof value === 'string' ? [value] : value;
    if (
      !Array.isArray(audiences) ||
      audiences.some((audience) => typeof audience !== 'string' || !audience)
    ) {
      throw new OidcError('invalid_token');
    }
    return Object.freeze([...new Set(audiences)]);
  }

  private exchangedClaims(
    payload: JWTPayload,
    target: Readonly<ClientCatalogEntry>,
    expectedSubject: string,
  ): ExchangedWebClientClaims {
    if (
      payload.sub !== expectedSubject ||
      payload.iss !== this.config.issuer ||
      !Number.isSafeInteger(payload.exp) ||
      !Number.isSafeInteger(payload.iat) ||
      payload.exp! > Number.MAX_SAFE_INTEGER / 1000
    ) {
      throw new OidcError('invalid_token');
    }

    const audience = this.readAudience(payload.aud);
    const rawAzp = payload.azp;
    if (rawAzp !== undefined && (typeof rawAzp !== 'string' || !rawAzp))
      throw new OidcError('invalid_token');
    const azp = typeof rawAzp === 'string' ? rawAzp : undefined;
    if (!audience.includes(target.audience) && azp !== target.clientId)
      throw new OidcError('invalid_token');

    const rawSid = payload.sid;
    if (rawSid !== undefined && (typeof rawSid !== 'string' || !rawSid))
      throw new OidcError('invalid_token');
    const sid = typeof rawSid === 'string' ? rawSid : undefined;

    const realmAccess = payload.realm_access;
    if (
      realmAccess !== undefined &&
      (realmAccess === null ||
        Array.isArray(realmAccess) ||
        typeof realmAccess !== 'object')
    ) {
      throw new OidcError('invalid_token');
    }
    const resourceAccess = payload.resource_access;
    if (
      resourceAccess !== undefined &&
      (resourceAccess === null ||
        Array.isArray(resourceAccess) ||
        typeof resourceAccess !== 'object')
    ) {
      throw new OidcError('invalid_token');
    }
    const targetAccess = (
      resourceAccess as Record<string, unknown> | undefined
    )?.[target.clientId];
    if (
      targetAccess !== undefined &&
      (targetAccess === null ||
        Array.isArray(targetAccess) ||
        typeof targetAccess !== 'object')
    ) {
      throw new OidcError('invalid_token');
    }

    return Object.freeze({
      subject: payload.sub,
      issuer: payload.iss,
      audience: Object.freeze([...audience]),
      ...(azp ? { azp } : {}),
      ...(sid ? { sid } : {}),
      realmRoles: this.normalizeClaimList(
        (realmAccess as Record<string, unknown> | undefined)?.roles,
      ),
      clientRoles: this.normalizeClaimList(
        (targetAccess as Record<string, unknown> | undefined)?.roles,
      ),
      groups: this.normalizeClaimList(payload.groups),
      expiresAt: payload.exp! * 1000,
    });
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
    return this.parseTokenResponse(
      await this.tokenEndpointRequest(
        this.networkUrl(metadata.token_endpoint),
        body,
      ),
    );
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
    return this.parseTokenResponse(
      await this.tokenEndpointRequest(
        this.networkUrl(metadata.token_endpoint),
        body,
      ),
    );
  }

  async revokeToken(token: string): Promise<void> {
    const metadata = await this.discovery();
    if (!metadata.revocation_endpoint) return;
    const body = new URLSearchParams({
      token,
      token_type_hint: 'refresh_token',
      client_id: this.config.hubClientId,
    });
    if (this.config.hubClientType === 'confidential')
      body.set('client_secret', this.config.hubClientSecret!);
    try {
      const response = await fetch(
        this.networkUrl(metadata.revocation_endpoint),
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(3000),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new OidcError('unavailable');
    } catch {
      throw new OidcError('unavailable');
    }
  }

  async logoutUrl(
    postLogoutRedirectUrl: string,
    idTokenHint?: string,
  ): Promise<string> {
    const metadata = await this.discovery();
    if (!metadata.end_session_endpoint) throw new OidcError('invalid_response');
    const url = new URL(metadata.end_session_endpoint);
    url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUrl);
    url.searchParams.set('client_id', this.config.hubClientId);
    if (idTokenHint) url.searchParams.set('id_token_hint', idTokenHint);
    return url.toString();
  }

  async exchangeWebClientToken(
    input: ExchangeWebClientTokenRequest,
  ): Promise<ExchangedWebClientToken> {
    if (
      this.config.hubClientType !== 'confidential' ||
      !this.config.hubClientSecret ||
      !input.subjectToken ||
      !input.expectedSubject ||
      !Object.values(this.config.clientCatalog).includes(input.target)
    ) {
      throw new OidcError('invalid_configuration');
    }

    const metadata = await this.discovery();
    const body = new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT,
      client_id: this.config.hubClientId,
      client_secret: this.config.hubClientSecret,
      subject_token: input.subjectToken,
      subject_token_type: ACCESS_TOKEN_TYPE,
      requested_token_type: ACCESS_TOKEN_TYPE,
      audience: input.target.audience,
    });
    const value = await this.tokenEndpointRequest(
      this.networkUrl(metadata.token_endpoint),
      body,
    );
    const receivedAt = Date.now();

    if (
      typeof value.access_token !== 'string' ||
      !value.access_token ||
      typeof value.token_type !== 'string' ||
      value.token_type.toLowerCase() !== 'bearer' ||
      !Number.isSafeInteger(value.expires_in) ||
      (value.expires_in as number) <= 0 ||
      (value.refresh_token !== undefined &&
        (typeof value.refresh_token !== 'string' || !value.refresh_token)) ||
      (value.id_token !== undefined &&
        (typeof value.id_token !== 'string' || !value.id_token)) ||
      (value.refresh_expires_in !== undefined &&
        (!Number.isSafeInteger(value.refresh_expires_in) ||
          (value.refresh_expires_in as number) < 0 ||
          (value.refresh_token !== undefined &&
            (value.refresh_expires_in as number) === 0))) ||
      (value.issued_token_type !== undefined &&
        value.issued_token_type !== ACCESS_TOKEN_TYPE) ||
      (value.scope !== undefined && typeof value.scope !== 'string')
    ) {
      throw new OidcError('invalid_response');
    }

    const accessToken = value.access_token as string;
    const refreshToken = value.refresh_token as string | undefined;
    const refreshExpiresIn =
      refreshToken === undefined
        ? undefined
        : (value.refresh_expires_in as number | undefined);
    const idToken = value.id_token as string | undefined;
    const scope = value.scope as string | undefined;
    const accessPayload = await this.verify(accessToken, 'invalid_token');
    const claims = this.exchangedClaims(
      accessPayload,
      input.target,
      input.expectedSubject,
    );
    if (idToken !== undefined) {
      const idPayload = await this.verify(idToken, 'invalid_token');
      if (idPayload.sub !== input.expectedSubject)
        throw new OidcError('invalid_token');
    }

    const expiresIn = value.expires_in as number;
    const relativeExpiresAt = receivedAt + expiresIn * 1000;
    if (!Number.isSafeInteger(relativeExpiresAt))
      throw new OidcError('invalid_response');
    const expiresAt = Math.min(claims.expiresAt, relativeExpiresAt);

    return Object.freeze({
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      expiresAt,
      ...(refreshToken !== undefined ? { refreshToken } : {}),
      ...(refreshExpiresIn !== undefined ? { refreshExpiresIn } : {}),
      ...(idToken !== undefined ? { idToken } : {}),
      ...(value.issued_token_type !== undefined
        ? { issuedTokenType: ACCESS_TOKEN_TYPE }
        : {}),
      ...(scope !== undefined ? { scope } : {}),
      claims,
    });
  }

  async evaluateUmaDecision(input: UmaDecisionRequest): Promise<boolean> {
    if (
      !input.accessToken ||
      !Object.values(this.config.clientCatalog).includes(input.target) ||
      !UMA_NAME.test(input.resource) ||
      !UMA_NAME.test(input.scope)
    ) {
      throw new OidcError('invalid_configuration');
    }

    const metadata = await this.discovery();
    const body = new URLSearchParams({
      grant_type: UMA_TICKET_GRANT,
      audience: input.target.resourceServer,
      permission: `${input.resource}#${input.scope}`,
      response_mode: 'decision',
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(this.networkUrl(metadata.token_endpoint), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: controller.signal,
        redirect: 'error',
      });
      const value = await this.boundedJson(response);
      if (!value || Array.isArray(value) || typeof value !== 'object')
        throw new OidcError('invalid_response');
      if (response.status === 401 || response.status === 403) {
        const error = value as Record<string, unknown>;
        const allowedKeys = new Set([
          'error',
          'error_description',
          'error_uri',
        ]);
        const optionalValueIsValid = (key: string) =>
          error[key] === undefined ||
          (typeof error[key] === 'string' &&
            error[key].length > 0 &&
            error[key].length <= OAUTH_ERROR_VALUE_MAX_LENGTH);
        if (
          Object.keys(error).every((key) => allowedKeys.has(key)) &&
          typeof error.error === 'string' &&
          UMA_DENIAL_ERRORS.has(error.error) &&
          optionalValueIsValid('error_description') &&
          optionalValueIsValid('error_uri')
        ) {
          return false;
        }
        throw new OidcError('invalid_response');
      }
      if (!response.ok)
        throw new OidcError(
          response.status >= 500 ? 'unavailable' : 'invalid_response',
        );
      const decision = value as Record<string, unknown>;
      const result = decision.result;
      if (Object.keys(decision).length !== 1 || typeof result !== 'boolean')
        throw new OidcError('invalid_response');
      return result === true;
    } catch (error) {
      if (controller.signal.aborted) throw new OidcError('unavailable');
      if (error instanceof OidcError) throw error;
      throw new OidcError('unavailable');
    } finally {
      clearTimeout(timeout);
    }
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

  private async verify(
    token: string,
    failure: 'invalid_response' | 'invalid_token' = 'invalid_response',
  ): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, await this.signingKeys(), {
        issuer: this.config.issuer,
        algorithms: ['RS256'],
      });
      if (!payload.sub || !Number.isFinite(payload.exp)) throw new OidcError();
      return payload;
    } catch {
      throw new OidcError(failure);
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

  async validateBackchannelLogoutToken(
    token: string,
  ): Promise<BackchannelLogoutClaims> {
    try {
      const { payload } = await jwtVerify(token, await this.signingKeys(), {
        issuer: this.config.issuer,
        audience: this.config.hubClientId,
        algorithms: ['RS256'],
      });
      const events = payload.events;
      const backchannelEvent =
        events && typeof events === 'object' && !Array.isArray(events)
          ? (events as Record<string, unknown>)[
              'http://schemas.openid.net/event/backchannel-logout'
            ]
          : undefined;
      const hasBackchannelEvent =
        !!events &&
        typeof events === 'object' &&
        !Array.isArray(events) &&
        Object.keys(events).length === 1 &&
        !!backchannelEvent &&
        typeof backchannelEvent === 'object' &&
        !Array.isArray(backchannelEvent) &&
        Object.keys(backchannelEvent).length === 0;
      const sid = payload.sid;
      const sub = payload.sub;
      if (
        !hasBackchannelEvent ||
        typeof payload.jti !== 'string' ||
        !payload.jti ||
        !Number.isSafeInteger(payload.iat) ||
        payload.nonce !== undefined ||
        (sid !== undefined && (typeof sid !== 'string' || !sid)) ||
        (sub !== undefined && (typeof sub !== 'string' || !sub)) ||
        (sid === undefined && sub === undefined)
      ) {
        throw new Error();
      }
      return {
        ...(typeof sid === 'string' ? { sid } : {}),
        ...(typeof sub === 'string' ? { sub } : {}),
      };
    } catch {
      throw new OidcError('invalid_token');
    }
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
