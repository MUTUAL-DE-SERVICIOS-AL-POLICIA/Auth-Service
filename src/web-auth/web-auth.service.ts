import { Inject, Injectable, Optional } from '@nestjs/common';
import { JWTPayload } from 'jose';
import {
  CheckWebSessionRequest,
  CheckWebSessionResponse,
  ExchangeWebCodeRequest,
  ExchangeWebCodeResponse,
  PresentationIdentity,
  StartWebLoginRequest,
  StartWebLoginResponse,
} from './contracts/web-auth.contracts';
import {
  createNonce,
  createPkce,
  createState,
  hashBrowserBinding,
} from './crypto';
import {
  asExchangeError,
  asSessionError,
  asStartError,
  WebAuthPublicError,
} from './errors/web-auth.errors';
import { KeycloakClient } from './oidc/keycloak-client';
import { normalizeHubReturnPath } from './return-path';
import { WebSession } from './session/web-session';
import { WebSessionStore } from './session/web-session.store';
import { PendingLoginStore } from './state/pending-login.store';
import { WebAuthConfig } from './web-auth.config';
import { WebAuthConfigToken } from './web-auth.tokens';

const OPAQUE_ID = /^[A-Za-z0-9_-]{43,128}$/;

@Injectable()
export class WebAuthService {
  constructor(
    @Inject(WebAuthConfigToken)
    private readonly config: WebAuthConfig | null,
    @Optional() private readonly oidc?: KeycloakClient,
    @Optional() private readonly pending?: PendingLoginStore,
    @Optional() private readonly sessions?: WebSessionStore,
  ) {}

  private enabled(): {
    config: WebAuthConfig;
    oidc: KeycloakClient;
    pending: PendingLoginStore;
    sessions: WebSessionStore;
  } {
    if (!this.config || !this.oidc || !this.pending || !this.sessions)
      throw new WebAuthPublicError('WEB_AUTH_DISABLED');
    return {
      config: this.config,
      oidc: this.oidc,
      pending: this.pending,
      sessions: this.sessions,
    };
  }

  async start(input: StartWebLoginRequest): Promise<StartWebLoginResponse> {
    const dependencies = this.enabled();
    try {
      if (!input || !OPAQUE_ID.test(input.browserBinding))
        throw new WebAuthPublicError('INVALID_LOGIN_REQUEST');
      const returnPath = normalizeHubReturnPath(input.returnPath);
      const state = createState();
      const nonce = createNonce();
      const pkce = createPkce();
      await dependencies.pending.create(state, {
        clientId: dependencies.config.hubClientId,
        codeVerifier: pkce.verifier,
        nonce,
        redirectUri: dependencies.config.callbackUrl,
        returnTo: returnPath,
        browserBindingHash: hashBrowserBinding(input.browserBinding),
        createdAt: Date.now(),
      });
      return {
        authorizationUrl: await dependencies.oidc.authorizationUrl({
          state,
          nonce,
          codeChallenge: pkce.challenge,
        }),
      };
    } catch (error) {
      throw asStartError(error);
    }
  }

  async exchange(
    input: ExchangeWebCodeRequest,
  ): Promise<ExchangeWebCodeResponse> {
    const dependencies = this.enabled();
    try {
      if (
        !input ||
        typeof input.code !== 'string' ||
        !input.code ||
        input.code.length > 4096 ||
        !OPAQUE_ID.test(input.state) ||
        !OPAQUE_ID.test(input.browserBinding)
      )
        throw new WebAuthPublicError('INVALID_LOGIN_REQUEST');

      const pending = await dependencies.pending.take(
        input.state,
        input.browserBinding,
      );
      const tokens = await dependencies.oidc.exchangeAuthorizationCode(
        input.code,
        pending.codeVerifier,
      );
      if (!tokens.id_token) throw new WebAuthPublicError('OIDC_LOGIN_FAILED');
      const [access, id] = await Promise.all([
        dependencies.oidc.validateAccessToken(tokens.access_token),
        dependencies.oidc.validateIdToken(tokens.id_token, pending.nonce),
      ]);
      if (!access.sub || access.sub !== id.sub)
        throw new WebAuthPublicError('OIDC_LOGIN_FAILED');

      const now = Date.now();
      const tokenExpiresAt = Math.min(
        access.exp! * 1000,
        id.exp! * 1000,
        now + tokens.expires_in * 1000,
      );
      const sessionExpiresAt = Math.min(
        tokenExpiresAt,
        now + dependencies.config.sessionTtlSeconds * 1000,
      );
      const identity = this.identity(id);
      const session: WebSession = {
        version: 1,
        subject: access.sub,
        issuer: dependencies.config.issuer,
        hubClientId: dependencies.config.hubClientId,
        createdAt: now,
        expiresAt: sessionExpiresAt,
        identity,
        hubTokens: {
          tokenType: tokens.token_type,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
          expiresAt: tokenExpiresAt,
        },
      };
      const sid = await dependencies.sessions.create(session);
      return { sid, returnPath: pending.returnTo, identity, sessionExpiresAt };
    } catch (error) {
      throw asExchangeError(error);
    }
  }

  async check(input: CheckWebSessionRequest): Promise<CheckWebSessionResponse> {
    const dependencies = this.enabled();
    try {
      if (!input || !OPAQUE_ID.test(input.sid))
        throw new WebAuthPublicError('SESSION_INVALID');
      const session = await dependencies.sessions.get(input.sid);
      return {
        authenticated: true,
        identity: session.identity,
        sessionExpiresAt: session.expiresAt,
      };
    } catch (error) {
      throw asSessionError(error);
    }
  }

  private identity(payload: JWTPayload): PresentationIdentity {
    const optional = (name: string): string | undefined =>
      typeof payload[name] === 'string' && payload[name]
        ? payload[name]
        : undefined;
    return {
      sub: payload.sub!,
      preferredUsername: optional('preferred_username'),
      name: optional('name'),
      givenName: optional('given_name'),
      familyName: optional('family_name'),
      email: optional('email'),
    };
  }
}
