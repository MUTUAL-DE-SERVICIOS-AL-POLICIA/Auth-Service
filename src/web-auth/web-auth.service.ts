import { Inject, Injectable, Optional } from '@nestjs/common';
import { JWTPayload } from 'jose';
import {
  CheckWebSessionRequest,
  CheckWebSessionResponse,
  CheckWebAuthorizationRequest,
  CheckWebAuthorizationResponse,
  EnsureWebClientContextRequest,
  EnsureWebClientContextResponse,
  ExchangeWebCodeRequest,
  ExchangeWebCodeResponse,
  PresentationIdentity,
  StartWebLoginRequest,
  StartWebLoginResponse,
  WebAuthorizationActor,
} from './contracts/web-auth.contracts';
import {
  createNonce,
  createPkce,
  createState,
  hashBrowserBinding,
} from './crypto';
import {
  asExchangeError,
  asAuthorizationError,
  asClientEnsureError,
  asSessionError,
  asStartError,
  WebAuthPublicError,
} from './errors/web-auth.errors';
import {
  ExchangedWebClientToken,
  KeycloakClient,
  OidcError,
} from './oidc/keycloak-client';
import { normalizeHubReturnPath } from './return-path';
import {
  isWebClientContext,
  WebClientContext,
  WebSession,
} from './session/web-session';
import { WebSessionStore } from './session/web-session.store';
import { PendingLoginStore } from './state/pending-login.store';
import { WebAuthConfig } from './web-auth.config';
import { WebAuthConfigToken } from './web-auth.tokens';
import {
  UnknownWebToolError,
  WebClientCatalogEntry,
} from './web-client-catalog';

const OPAQUE_ID = /^[A-Za-z0-9_-]{43,128}$/;
const ABSOLUTE_SESSION_MAX_MS = 8 * 60 * 60 * 1000;
const TOOL_KEY = /^[a-z][a-z0-9-]{0,63}$/;
const WEB_AUTHORIZATION_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CLIENT_ENSURE_MAX_ATTEMPTS = 3;

class RetryClientEnsureError extends Error {}
class PrimarySubjectInvalidGrantError extends Error {}

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
      const absoluteExpiresAt =
        now +
        Math.min(
          dependencies.config.sessionTtlSeconds * 1000,
          ABSOLUTE_SESSION_MAX_MS,
        );
      const idleExpiresAt = Math.min(
        absoluteExpiresAt,
        now + dependencies.config.sessionIdleTtlSeconds * 1000,
      );
      const identity = this.identity(id);
      const session: WebSession = {
        schemaVersion: 2,
        revision: 1,
        status: 'active',
        subject: access.sub,
        issuer: dependencies.config.issuer,
        hubClientId: dependencies.config.hubClientId,
        createdAt: now,
        absoluteExpiresAt,
        idleExpiresAt,
        lastActivityAt: now,
        identity,
        primary: {
          tokenType: tokens.token_type,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
          idExpiresAt: tokens.id_token ? id.exp! * 1000 : undefined,
          issuedAt: now,
          accessExpiresAt: tokenExpiresAt,
          refreshExpiresAt: tokens.refresh_expires_in
            ? now + tokens.refresh_expires_in * 1000
            : undefined,
        },
        clients: {},
      };
      const sid = await dependencies.sessions.create(session);
      return {
        sid,
        returnPath: pending.returnTo,
        identity,
        sessionExpiresAt: idleExpiresAt,
        sessionAbsoluteExpiresAt: absoluteExpiresAt,
      };
    } catch (error) {
      throw asExchangeError(error);
    }
  }

  async check(input: CheckWebSessionRequest): Promise<CheckWebSessionResponse> {
    const dependencies = this.enabled();
    try {
      if (!input || !OPAQUE_ID.test(input.sid))
        throw new WebAuthPublicError('SESSION_INVALID');
      const current = await dependencies.sessions.get(input.sid);
      const session =
        current.primary.accessExpiresAt >
        Date.now() + dependencies.config.refreshSkewSeconds * 1000
          ? await this.recordActivity(input.sid, current, dependencies)
          : await this.refreshPrimary(input.sid, current, dependencies);
      return {
        authenticated: true,
        identity: session.identity,
        sessionExpiresAt: Math.min(
          session.absoluteExpiresAt,
          session.idleExpiresAt,
        ),
      };
    } catch (error) {
      throw asSessionError(error);
    }
  }

  async ensureWebClientContext(
    input: EnsureWebClientContextRequest,
  ): Promise<EnsureWebClientContextResponse> {
    const dependencies = this.enabled();
    try {
      if (!input || !OPAQUE_ID.test(input.sid))
        throw new WebAuthPublicError('SESSION_INVALID');
      if (typeof input.tool !== 'string' || !TOOL_KEY.test(input.tool))
        throw new WebAuthPublicError('INVALID_CLIENT_REQUEST');
      let target: Readonly<WebClientCatalogEntry>;
      try {
        target = dependencies.config.resolveWebTool(input.tool);
      } catch (error) {
        if (error instanceof UnknownWebToolError)
          throw new WebAuthPublicError('WEB_TOOL_UNAVAILABLE');
        throw error;
      }
      return await this.ensureClientContext(
        input.sid,
        input.tool,
        target,
        dependencies,
      );
    } catch (error) {
      throw asClientEnsureError(error);
    }
  }

  async checkAuthorization(
    input: CheckWebAuthorizationRequest,
  ): Promise<CheckWebAuthorizationResponse> {
    const dependencies = this.enabled();
    try {
      if (
        !input ||
        typeof input !== 'object' ||
        Object.getPrototypeOf(input) !== Object.prototype ||
        Object.keys(input).length !== 4 ||
        !Object.prototype.hasOwnProperty.call(input, 'sid') ||
        !Object.prototype.hasOwnProperty.call(input, 'tool') ||
        !Object.prototype.hasOwnProperty.call(input, 'resource') ||
        !Object.prototype.hasOwnProperty.call(input, 'scope') ||
        typeof input.sid !== 'string' ||
        typeof input.tool !== 'string' ||
        typeof input.resource !== 'string' ||
        typeof input.scope !== 'string' ||
        !OPAQUE_ID.test(input.sid) ||
        !TOOL_KEY.test(input.tool) ||
        !WEB_AUTHORIZATION_IDENTIFIER.test(input.resource) ||
        !WEB_AUTHORIZATION_IDENTIFIER.test(input.scope)
      ) {
        throw new WebAuthPublicError('INVALID_AUTHORIZATION_REQUEST');
      }
      let target: Readonly<WebClientCatalogEntry>;
      try {
        target = dependencies.config.resolveWebTool(input.tool);
      } catch {
        throw new WebAuthPublicError('INVALID_AUTHORIZATION_REQUEST');
      }

      await this.ensureWebClientContext({
        sid: input.sid,
        tool: input.tool,
      });
      const session = await dependencies.sessions.get(input.sid);
      const context = session.clients[input.tool];
      if (
        !this.contextIsUsable(
          context,
          session,
          input.tool,
          target,
          dependencies.config,
        )
      ) {
        throw new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');
      }

      const authorized = await dependencies.oidc.evaluateUmaDecision({
        accessToken: context.tokens.accessToken,
        target,
        resource: input.resource,
        scope: input.scope,
      });
      if (!authorized) return { authorized: false };

      const actor: WebAuthorizationActor = {
        sub: session.subject,
      };
      if (
        typeof session.identity.preferredUsername === 'string' &&
        /\S/.test(session.identity.preferredUsername)
      )
        actor.preferredUsername = session.identity.preferredUsername;
      if (
        typeof session.identity.name === 'string' &&
        /\S/.test(session.identity.name)
      )
        actor.name = session.identity.name;
      return { authorized: true, actor };
    } catch (error) {
      throw asAuthorizationError(error);
    }
  }

  private async ensureClientContext(
    sid: string,
    tool: string,
    target: Readonly<WebClientCatalogEntry>,
    dependencies: ReturnType<WebAuthService['enabled']>,
    attempt = 0,
  ): Promise<EnsureWebClientContextResponse> {
    if (attempt >= CLIENT_ENSURE_MAX_ATTEMPTS)
      throw new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');

    const observed = await dependencies.sessions.get(sid);
    await this.ensurePrimaryForClient(sid, observed, dependencies);
    const owner = await dependencies.sessions.acquireClientLock(sid, tool);
    if (!owner) {
      await dependencies.sessions.waitForRevision(sid, observed.revision);
      return this.ensureClientContext(
        sid,
        tool,
        target,
        dependencies,
        attempt + 1,
      );
    }

    let retryAfterRelease = false;
    let recoverPrimary = false;
    let invalidGrantPrimaryAccessToken: string | undefined;
    try {
      let current = await dependencies.sessions.get(sid);
      if (!this.primaryIsUsable(current, dependencies.config))
        throw new RetryClientEnsureError();

      const existing = current.clients[tool];
      let context = this.contextIsUsable(
        existing,
        current,
        tool,
        target,
        dependencies.config,
      )
        ? existing
        : undefined;

      if (!context) {
        let exchanged: ExchangedWebClientToken;
        try {
          exchanged = await dependencies.oidc.exchangeWebClientToken({
            subjectToken: current.primary.accessToken,
            expectedSubject: current.subject,
            target,
          });
        } catch (error) {
          if (error instanceof OidcError && error.kind === 'invalid_grant') {
            invalidGrantPrimaryAccessToken = current.primary.accessToken;
            throw new PrimarySubjectInvalidGrantError();
          }
          throw error;
        }
        context = this.clientContext(tool, target, exchanged);
        if (
          !this.contextIsUsable(
            context,
            current,
            tool,
            target,
            dependencies.config,
          )
        )
          throw new OidcError('invalid_token');
      }

      for (let revisionAttempt = 0; revisionAttempt < 3; revisionAttempt++) {
        const now = Date.now();
        const update = await dependencies.sessions.replaceClientContext(
          sid,
          current.revision,
          tool,
          context,
          owner,
          now,
        );
        if (update === 'updated') {
          const updated = this.withClientActivity(current, tool, context, now);
          return this.clientResponse(updated, context);
        }
        if (update === 'lock_lost') throw new RetryClientEnsureError();
        const winner = await dependencies.sessions.get(sid);
        const winnerContext = winner.clients[tool];
        if (
          this.contextIsUsable(
            winnerContext,
            winner,
            tool,
            target,
            dependencies.config,
          )
        )
          return this.clientResponse(winner, winnerContext);
        if (!this.primaryIsUsable(winner, dependencies.config))
          throw new RetryClientEnsureError();
        current = winner;
      }
      throw new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');
    } catch (error) {
      retryAfterRelease = error instanceof RetryClientEnsureError;
      recoverPrimary = error instanceof PrimarySubjectInvalidGrantError;
      if (!retryAfterRelease && !recoverPrimary) throw error;
    } finally {
      await dependencies.sessions
        .releaseClientLock(sid, tool, owner)
        .catch(() => undefined);
    }

    if (recoverPrimary) {
      const current = await dependencies.sessions.get(sid);
      if (current.primary.accessToken === invalidGrantPrimaryAccessToken) {
        await this.refreshPrimary(sid, current, dependencies, 0, {
          recordActivity: false,
          force: true,
        });
      }
    }
    return this.ensureClientContext(
      sid,
      tool,
      target,
      dependencies,
      attempt + 1,
    );
  }

  private async ensurePrimaryForClient(
    sid: string,
    session: WebSession,
    dependencies: ReturnType<WebAuthService['enabled']>,
  ): Promise<WebSession> {
    if (this.primaryIsUsable(session, dependencies.config)) return session;
    return this.refreshPrimary(sid, session, dependencies, 0, {
      recordActivity: false,
      force: false,
    });
  }

  private primaryIsUsable(session: WebSession, config: WebAuthConfig): boolean {
    return (
      session.status === 'active' &&
      session.issuer === config.issuer &&
      session.hubClientId === config.hubClientId &&
      session.idleExpiresAt > Date.now() &&
      session.absoluteExpiresAt > Date.now() &&
      session.primary.accessExpiresAt >
        Date.now() + config.refreshSkewSeconds * 1000
    );
  }

  private contextIsUsable(
    context: WebClientContext | undefined,
    session: WebSession,
    tool: string,
    target: Readonly<WebClientCatalogEntry>,
    config: WebAuthConfig,
  ): context is WebClientContext {
    return !!(
      context &&
      isWebClientContext(context) &&
      context.tool === tool &&
      context.clientId === target.clientId &&
      context.audience === target.audience &&
      context.resourceServer === target.resourceServer &&
      context.source === 'token-exchange' &&
      context.subject === session.subject &&
      context.issuer === session.issuer &&
      context.tokens.tokenType === 'Bearer' &&
      context.tokens.accessExpiresAt >
        Date.now() + config.refreshSkewSeconds * 1000
    );
  }

  private clientContext(
    tool: string,
    target: Readonly<WebClientCatalogEntry>,
    exchanged: ExchangedWebClientToken,
  ): WebClientContext {
    const now = Date.now();
    return {
      tool,
      clientId: target.clientId,
      audience: target.audience,
      resourceServer: target.resourceServer,
      source: 'token-exchange',
      tokens: {
        tokenType: 'Bearer',
        accessToken: exchanged.accessToken,
        accessExpiresAt: exchanged.expiresAt,
        issuedAt: now,
        refreshToken: exchanged.refreshToken,
        refreshExpiresIn: exchanged.refreshExpiresIn,
        idToken: exchanged.idToken,
        issuedTokenType: exchanged.issuedTokenType,
        scope: exchanged.scope,
      },
      subject: exchanged.claims.subject,
      issuer: exchanged.claims.issuer,
      azp: exchanged.claims.azp,
      keycloakSessionId: exchanged.claims.sid,
      realmRoles: [...exchanged.claims.realmRoles],
      clientRoles: [...exchanged.claims.clientRoles],
      groups: [...exchanged.claims.groups],
    };
  }

  private withClientActivity(
    session: WebSession,
    tool: string,
    context: WebClientContext,
    now: number,
  ): WebSession {
    return {
      ...session,
      revision: session.revision + 1,
      lastActivityAt: now,
      idleExpiresAt: Math.min(
        session.absoluteExpiresAt,
        now + this.config!.sessionIdleTtlSeconds * 1000,
      ),
      clients: { ...session.clients, [tool]: context },
    };
  }

  private clientResponse(
    session: WebSession,
    context: WebClientContext,
  ): EnsureWebClientContextResponse {
    return {
      authenticated: true,
      currentTool: context.tool,
      currentClient: context.clientId,
      identity: session.identity,
      realmRoles: [...context.realmRoles],
      clientRoles: [...context.clientRoles],
      groups: [...context.groups],
      contextExpiresAt: context.tokens.accessExpiresAt,
      sessionExpiresAt: Math.min(
        session.idleExpiresAt,
        session.absoluteExpiresAt,
      ),
      sessionAbsoluteExpiresAt: session.absoluteExpiresAt,
    };
  }

  private withActivity(session: WebSession, now = Date.now()): WebSession {
    return {
      ...session,
      revision: session.revision + 1,
      lastActivityAt: now,
      idleExpiresAt: Math.min(
        session.absoluteExpiresAt,
        now + this.config!.sessionIdleTtlSeconds * 1000,
      ),
    };
  }

  private async recordActivity(
    sid: string,
    session: WebSession,
    dependencies: ReturnType<WebAuthService['enabled']>,
  ): Promise<WebSession> {
    const next = this.withActivity(session);
    if (await dependencies.sessions.replace(sid, session.revision, next))
      return next;
    return dependencies.sessions.get(sid);
  }

  private async refreshPrimary(
    sid: string,
    observed: WebSession,
    dependencies: ReturnType<WebAuthService['enabled']>,
    lockAttempt = 0,
    options: { recordActivity: boolean; force: boolean } = {
      recordActivity: true,
      force: false,
    },
  ): Promise<WebSession> {
    if (!observed.primary.refreshToken) {
      await dependencies.sessions.delete(sid);
      throw new WebAuthPublicError('SESSION_INVALID');
    }
    const owner = await dependencies.sessions.acquireRefreshLock(sid);
    if (!owner) {
      const winner = await dependencies.sessions.waitForRevision(
        sid,
        observed.revision,
      );
      const winnerRenewed =
        winner.primary.accessToken !== observed.primary.accessToken ||
        winner.primary.accessExpiresAt > observed.primary.accessExpiresAt;
      if (winnerRenewed && winner.primary.accessExpiresAt > Date.now())
        return winner;
      if (lockAttempt >= 1)
        throw new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');
      return this.refreshPrimary(
        sid,
        winner,
        dependencies,
        lockAttempt + 1,
        options,
      );
    }
    try {
      const current = await dependencies.sessions.get(sid);
      if (
        !options.force &&
        current.primary.accessExpiresAt >
          Date.now() + dependencies.config.refreshSkewSeconds * 1000
      )
        return options.recordActivity
          ? this.recordActivity(sid, current, dependencies)
          : current;

      const tokens = await dependencies.oidc.refreshPrimaryToken(
        current.primary.refreshToken!,
      );
      const access = await dependencies.oidc.validateAccessToken(
        tokens.access_token,
      );
      if (!access.sub || access.sub !== current.subject)
        throw new OidcError('invalid_response');

      let refreshedId: { token: string; expiresAt: number } | undefined;
      if (tokens.id_token) {
        const id = await dependencies.oidc.validateRefreshedIdToken(
          tokens.id_token,
        );
        if (!id.sub || id.sub !== current.subject)
          throw new OidcError('invalid_response');
        refreshedId = { token: tokens.id_token, expiresAt: id.exp! * 1000 };
      }

      const now = Date.now();
      const keepExistingId =
        !refreshedId &&
        !!current.primary.idToken &&
        !!current.primary.idExpiresAt &&
        current.primary.idExpiresAt > now;
      const primary = {
        tokenType: tokens.token_type,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? current.primary.refreshToken,
        ...(refreshedId
          ? {
              idToken: refreshedId.token,
              idExpiresAt: refreshedId.expiresAt,
            }
          : keepExistingId
            ? {
                idToken: current.primary.idToken,
                idExpiresAt: current.primary.idExpiresAt,
              }
            : {}),
        issuedAt: now,
        accessExpiresAt: Math.min(
          access.exp! * 1000,
          now + tokens.expires_in * 1000,
        ),
        refreshExpiresAt: tokens.refresh_expires_in
          ? now + tokens.refresh_expires_in * 1000
          : current.primary.refreshExpiresAt,
      };
      let base = current;
      for (let attempt = 0; attempt < 3; attempt++) {
        const next = options.recordActivity
          ? this.withActivity({ ...base, primary }, now)
          : { ...base, revision: base.revision + 1, primary };
        if (await dependencies.sessions.replace(sid, base.revision, next))
          return next;
        const winner = await dependencies.sessions.get(sid);
        const primaryChanged =
          winner.primary.accessToken !== base.primary.accessToken ||
          winner.primary.accessExpiresAt > base.primary.accessExpiresAt;
        if (primaryChanged) {
          if (winner.primary.accessExpiresAt <= Date.now())
            throw new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');
          return winner;
        }
        base = winner;
      }
      throw new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');
    } catch (error) {
      if (error instanceof OidcError && error.kind === 'invalid_grant') {
        await dependencies.sessions.delete(sid);
        throw new WebAuthPublicError('SESSION_INVALID');
      }
      if (error instanceof WebAuthPublicError) throw error;
      throw new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');
    } finally {
      await dependencies.sessions
        .releaseRefreshLock(sid, owner)
        .catch(() => undefined);
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
