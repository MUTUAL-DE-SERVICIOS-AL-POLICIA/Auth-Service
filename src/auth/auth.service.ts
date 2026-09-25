import { Inject, Injectable, Optional } from '@nestjs/common';
import { JWTPayload } from 'jose';
import {
  CheckSessionRequest,
  CheckSessionResponse,
  CheckWebAuthorizationRequest,
  CheckWebAuthorizationResponse,
  EnsureWebClientContextRequest,
  EnsureWebClientContextResponse,
  ExchangeWebCodeRequest,
  ExchangeWebCodeResponse,
  LogoutWebSessionRequest,
  LogoutWebSessionResponse,
  PresentationIdentity,
  StartWebLoginRequest,
  StartWebLoginResponse,
  WebAuthorizationActor,
} from './contracts/auth.contracts';
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
  AuthPublicError,
} from './errors/auth.errors';
import {
  ExchangedWebClientToken,
  KeycloakClient,
  OidcError,
} from './oidc/keycloak-client';
import { normalizeHubReturnPath } from './return-path';
import {
  isWebClientContext,
  WebClientContext,
  Session,
} from './session/session';
import { SessionStore, SessionWaitTimeoutError } from './session/session.store';
import { StoreUnavailableError } from '../common/services/redis.service';
import { PendingLoginStore } from './state/pending-login.store';
import { AuthConfig } from './config/auth.config';
import { AuthConfigToken } from './auth.tokens';
import {
  UnknownWebToolError,
  ClientCatalogEntry,
} from './config/client-catalog';

const OPAQUE_ID = /^[A-Za-z0-9_-]{43,128}$/;
const ABSOLUTE_SESSION_MAX_MS = 8 * 60 * 60 * 1000;
const TOOL_KEY = /^[a-z][a-z0-9-]{0,63}$/;
const WEB_AUTHORIZATION_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CLIENT_ENSURE_MAX_ATTEMPTS = 3;
const CLIENT_REVISION_WAIT_MS = 3_500;

class RetryClientEnsureError extends Error {}
class PrimarySubjectInvalidGrantError extends Error {}

type CoordinatedClientContextResponse = Omit<
  EnsureWebClientContextResponse,
  'permissions' | 'permissionsExpiresAt'
>;

@Injectable()
export class AuthService {
  constructor(
    @Inject(AuthConfigToken)
    private readonly config: AuthConfig | null,
    @Optional() private readonly oidc?: KeycloakClient,
    @Optional() private readonly pending?: PendingLoginStore,
    @Optional() private readonly sessions?: SessionStore,
  ) {}

  private enabled(): {
    config: AuthConfig;
    oidc: KeycloakClient;
    pending: PendingLoginStore;
    sessions: SessionStore;
  } {
    if (!this.config || !this.oidc || !this.pending || !this.sessions)
      throw new AuthPublicError('WEB_AUTH_DISABLED');
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
        throw new AuthPublicError('INVALID_LOGIN_REQUEST');
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
        throw new AuthPublicError('INVALID_LOGIN_REQUEST');

      const pending = await dependencies.pending.take(
        input.state,
        input.browserBinding,
      );
      const tokens = await dependencies.oidc.exchangeAuthorizationCode(
        input.code,
        pending.codeVerifier,
      );
      if (!tokens.id_token) throw new AuthPublicError('OIDC_LOGIN_FAILED');
      const [access, id] = await Promise.all([
        dependencies.oidc.validateAccessToken(tokens.access_token),
        dependencies.oidc.validateIdToken(tokens.id_token, pending.nonce),
      ]);
      if (!access.sub || access.sub !== id.sub)
        throw new AuthPublicError('OIDC_LOGIN_FAILED');
      const keycloakSessionId = this.oidcSessionId(access, id);

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
      const session: Session = {
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
          ...(keycloakSessionId ? { keycloakSessionId } : {}),
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

  async logout(
    input: LogoutWebSessionRequest,
  ): Promise<LogoutWebSessionResponse> {
    const dependencies = this.enabled();
    if (!input || !OPAQUE_ID.test(input.sid))
      throw new AuthPublicError('SESSION_INVALID');

    let session: Session | undefined;
    try {
      session = await dependencies.sessions.get(input.sid);
    } catch {
      throw new AuthPublicError('SESSION_INVALID');
    }

    try {
      if (session.primary.refreshToken) {
        await dependencies.oidc.revokeToken(session.primary.refreshToken);
      }
    } catch {
      // Redis invalidation and browser logout still proceed if revocation is unavailable.
    } finally {
      await dependencies.sessions.delete(input.sid);
    }

    let logoutUrl: string;
    try {
      logoutUrl = await dependencies.oidc.logoutUrl(
        dependencies.config.postLogoutRedirectUrl,
        session.primary.idToken,
      );
    } catch {
      throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
    }
    return { logoutUrl };
  }

  async backchannelLogout(logoutToken: string): Promise<void> {
    const dependencies = this.enabled();
    try {
      const claims =
        await dependencies.oidc.validateBackchannelLogoutToken(logoutToken);
      await dependencies.sessions.deleteByOidcSession(claims.sid, claims.sub);
    } catch (error) {
      if (error instanceof OidcError && error.kind === 'invalid_token')
        throw new AuthPublicError('INVALID_LOGOUT_TOKEN');
      if (error instanceof StoreUnavailableError)
        throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
      throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
    }
  }

  async check(input: CheckSessionRequest): Promise<CheckSessionResponse> {
    const dependencies = this.enabled();
    try {
      if (!input || !OPAQUE_ID.test(input.sid))
        throw new AuthPublicError('SESSION_INVALID');
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
  ): Promise<CoordinatedClientContextResponse> {
    const dependencies = this.enabled();
    try {
      if (!input || !OPAQUE_ID.test(input.sid))
        throw new AuthPublicError('SESSION_INVALID');
      if (typeof input.tool !== 'string' || !TOOL_KEY.test(input.tool))
        throw new AuthPublicError('INVALID_CLIENT_REQUEST');
      let target: Readonly<ClientCatalogEntry>;
      try {
        target = dependencies.config.resolveTool(input.tool);
      } catch (error) {
        if (error instanceof UnknownWebToolError)
          throw new AuthPublicError('WEB_TOOL_UNAVAILABLE');
        throw error;
      }
      if (input.tool === dependencies.config.hubToolKey)
        return await this.ensurePrimaryToolContext(
          input.sid,
          input.tool,
          target,
          dependencies,
        );
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

  async getWebClientContext(
    input: EnsureWebClientContextRequest,
  ): Promise<EnsureWebClientContextResponse> {
    const dependencies = this.enabled();
    try {
      if (
        !input ||
        typeof input !== 'object' ||
        Object.getPrototypeOf(input) !== Object.prototype ||
        Object.keys(input).length !== 2 ||
        !Object.prototype.hasOwnProperty.call(input, 'sid') ||
        !Object.prototype.hasOwnProperty.call(input, 'tool') ||
        typeof input.sid !== 'string' ||
        typeof input.tool !== 'string' ||
        !OPAQUE_ID.test(input.sid) ||
        !TOOL_KEY.test(input.tool)
      )
        throw new AuthPublicError('INVALID_CLIENT_REQUEST');

      let target: Readonly<ClientCatalogEntry>;
      try {
        target = dependencies.config.resolveTool(input.tool);
      } catch (error) {
        if (error instanceof UnknownWebToolError)
          throw new AuthPublicError('WEB_TOOL_UNAVAILABLE');
        throw error;
      }

      await this.assertToolLaunchAccess(
        input.sid,
        input.tool,
        target,
        dependencies,
      );
      const coordinated = await this.ensureWebClientContext(input);
      const session = await dependencies.sessions.get(input.sid);
      let accessToken: string;
      let accessExpiresAt: number;
      if (input.tool === dependencies.config.hubToolKey) {
        if (!this.primaryIsUsable(session, dependencies.config))
          throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
        accessToken = session.primary.accessToken;
        accessExpiresAt = session.primary.accessExpiresAt;
      } else {
        const context = session.clients[input.tool];
        if (
          !this.contextIsUsable(
            context,
            session,
            input.tool,
            target,
            dependencies.config,
          )
        )
          throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
        accessToken = context.tokens.accessToken;
        accessExpiresAt = context.tokens.accessExpiresAt;
      }

      const permissions = await dependencies.oidc.getUmaPermissions({
        accessToken,
        target,
      });
      const permissionsExpiresAt = Math.min(
        accessExpiresAt,
        session.idleExpiresAt,
        session.absoluteExpiresAt,
      );
      return {
        ...coordinated,
        identity: session.identity,
        permissions: permissions.map((permission) => ({
          resource: permission.resource,
          scopes: [...permission.scopes],
        })),
        contextExpiresAt: permissionsExpiresAt,
        permissionsExpiresAt,
        sessionExpiresAt: Math.min(
          session.idleExpiresAt,
          session.absoluteExpiresAt,
        ),
        sessionAbsoluteExpiresAt: session.absoluteExpiresAt,
      };
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
        throw new AuthPublicError('INVALID_AUTHORIZATION_REQUEST');
      }
      let target: Readonly<ClientCatalogEntry>;
      try {
        target = dependencies.config.resolveTool(input.tool);
      } catch {
        throw new AuthPublicError('INVALID_AUTHORIZATION_REQUEST');
      }

      await this.assertToolLaunchAccess(
        input.sid,
        input.tool,
        target,
        dependencies,
      );
      await this.ensureWebClientContext({
        sid: input.sid,
        tool: input.tool,
      });
      const session = await dependencies.sessions.get(input.sid);
      let accessToken: string;
      if (input.tool === dependencies.config.hubToolKey) {
        if (!this.primaryIsUsable(session, dependencies.config))
          throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
        accessToken = session.primary.accessToken;
      } else {
        const context = session.clients[input.tool];
        if (
          !this.contextIsUsable(
            context,
            session,
            input.tool,
            target,
            dependencies.config,
          )
        )
          throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
        accessToken = context.tokens.accessToken;
      }

      const authorized = await dependencies.oidc.evaluateUmaDecision({
        accessToken,
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

  private async assertToolLaunchAccess(
    sid: string,
    tool: string,
    target: Readonly<ClientCatalogEntry>,
    dependencies: ReturnType<AuthService['enabled']>,
  ): Promise<void> {
    if (tool === dependencies.config.hubToolKey) return;

    const observed = await dependencies.sessions.get(sid);
    const session = await this.ensurePrimaryForClient(
      sid,
      observed,
      dependencies,
    );
    if (!this.primaryIsUsable(session, dependencies.config))
      throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');

    const allowed = await dependencies.oidc.evaluateUmaDecision({
      accessToken: session.primary.accessToken,
      target: dependencies.config.hubTarget,
      resource: target.clientId,
      scope: 'launch',
    });
    if (!allowed) {
      await this.discardClientContext(sid, tool, session, dependencies);
      throw new AuthPublicError('WEB_CLIENT_ACCESS_DENIED');
    }
  }

  private async discardClientContext(
    sid: string,
    tool: string,
    observed: Session,
    dependencies: ReturnType<AuthService['enabled']>,
  ): Promise<void> {
    let current = observed;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!current.clients[tool]) return;
      const clients = { ...current.clients };
      delete clients[tool];
      const next: Session = {
        ...current,
        revision: current.revision + 1,
        clients,
      };
      if (await dependencies.sessions.replace(sid, current.revision, next))
        return;
      current = await dependencies.sessions.get(sid);
    }
    throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
  }

  private async ensureClientContext(
    sid: string,
    tool: string,
    target: Readonly<ClientCatalogEntry>,
    dependencies: ReturnType<AuthService['enabled']>,
    attempt = 0,
  ): Promise<CoordinatedClientContextResponse> {
    if (attempt >= CLIENT_ENSURE_MAX_ATTEMPTS)
      throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');

    const observed = await dependencies.sessions.get(sid);
    await this.ensurePrimaryForClient(sid, observed, dependencies);
    const owner = await dependencies.sessions.acquireClientLock(sid, tool);
    if (!owner) {
      try {
        await dependencies.sessions.waitForRevision(
          sid,
          observed.revision,
          CLIENT_REVISION_WAIT_MS,
        );
      } catch (error) {
        // An OIDC exchange may legitimately outlive the first lock wait.
        // Retry acquisition/read without treating contention as an invalid session.
        if (!(error instanceof SessionWaitTimeoutError)) throw error;
      }
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
      throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
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

  private async ensurePrimaryToolContext(
    sid: string,
    tool: string,
    target: Readonly<ClientCatalogEntry>,
    dependencies: ReturnType<AuthService['enabled']>,
  ): Promise<CoordinatedClientContextResponse> {
    const observed = await dependencies.sessions.get(sid);
    const session = this.primaryIsUsable(observed, dependencies.config)
      ? await this.recordActivity(sid, observed, dependencies)
      : await this.refreshPrimary(sid, observed, dependencies, 0, {
          recordActivity: true,
          force: false,
        });
    if (!this.primaryIsUsable(session, dependencies.config))
      throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
    const claims = await dependencies.oidc.validateToolAccessToken(
      session.primary.accessToken,
      session.subject,
      target,
    );
    return {
      authenticated: true,
      currentTool: tool,
      currentClient: target.clientId,
      identity: session.identity,
      realmRoles: [...claims.realmRoles],
      clientRoles: [...claims.clientRoles],
      groups: [...claims.groups],
      contextExpiresAt: Math.min(
        claims.expiresAt,
        session.primary.accessExpiresAt,
        session.idleExpiresAt,
        session.absoluteExpiresAt,
      ),
      sessionExpiresAt: Math.min(
        session.idleExpiresAt,
        session.absoluteExpiresAt,
      ),
      sessionAbsoluteExpiresAt: session.absoluteExpiresAt,
    };
  }

  private async ensurePrimaryForClient(
    sid: string,
    session: Session,
    dependencies: ReturnType<AuthService['enabled']>,
  ): Promise<Session> {
    if (this.primaryIsUsable(session, dependencies.config)) return session;
    return this.refreshPrimary(sid, session, dependencies, 0, {
      recordActivity: false,
      force: false,
    });
  }

  private primaryIsUsable(session: Session, config: AuthConfig): boolean {
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
    session: Session,
    tool: string,
    target: Readonly<ClientCatalogEntry>,
    config: AuthConfig,
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
    target: Readonly<ClientCatalogEntry>,
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
    session: Session,
    tool: string,
    context: WebClientContext,
    now: number,
  ): Session {
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
    session: Session,
    context: WebClientContext,
  ): CoordinatedClientContextResponse {
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

  private withActivity(session: Session, now = Date.now()): Session {
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
    session: Session,
    dependencies: ReturnType<AuthService['enabled']>,
  ): Promise<Session> {
    const next = this.withActivity(session);
    if (await dependencies.sessions.replace(sid, session.revision, next))
      return next;
    return dependencies.sessions.get(sid);
  }

  private async refreshPrimary(
    sid: string,
    observed: Session,
    dependencies: ReturnType<AuthService['enabled']>,
    lockAttempt = 0,
    options: { recordActivity: boolean; force: boolean } = {
      recordActivity: true,
      force: false,
    },
  ): Promise<Session> {
    if (!observed.primary.refreshToken) {
      await dependencies.sessions.delete(sid);
      throw new AuthPublicError('SESSION_INVALID');
    }
    const owner = await dependencies.sessions.acquireRefreshLock(sid);
    if (!owner) {
      let winner: Session;
      try {
        winner = await dependencies.sessions.waitForRevision(
          sid,
          observed.revision,
          CLIENT_REVISION_WAIT_MS,
        );
      } catch (error) {
        if (!(error instanceof SessionWaitTimeoutError)) throw error;
        if (lockAttempt >= 1)
          throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
        return this.refreshPrimary(
          sid,
          await dependencies.sessions.get(sid),
          dependencies,
          lockAttempt + 1,
          options,
        );
      }
      const winnerRenewed =
        winner.primary.accessToken !== observed.primary.accessToken ||
        winner.primary.accessExpiresAt > observed.primary.accessExpiresAt;
      if (winnerRenewed && winner.primary.accessExpiresAt > Date.now())
        return winner;
      if (lockAttempt >= 1)
        throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
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

      let refreshedId:
        { token: string; expiresAt: number; claims: JWTPayload } | undefined;
      if (tokens.id_token) {
        const id = await dependencies.oidc.validateRefreshedIdToken(
          tokens.id_token,
        );
        if (!id.sub || id.sub !== current.subject)
          throw new OidcError('invalid_response');
        refreshedId = {
          token: tokens.id_token,
          expiresAt: id.exp! * 1000,
          claims: id,
        };
      }

      const now = Date.now();
      const keepExistingId =
        !refreshedId &&
        !!current.primary.idToken &&
        !!current.primary.idExpiresAt &&
        current.primary.idExpiresAt > now;
      const refreshedSessionId = this.oidcSessionId(
        access,
        refreshedId?.claims,
      );
      if (
        current.primary.keycloakSessionId &&
        refreshedSessionId &&
        current.primary.keycloakSessionId !== refreshedSessionId
      )
        throw new OidcError('invalid_response');
      const keycloakSessionId =
        refreshedSessionId ?? current.primary.keycloakSessionId;
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
        ...(keycloakSessionId ? { keycloakSessionId } : {}),
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
            throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
          return winner;
        }
        base = winner;
      }
      throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
    } catch (error) {
      if (error instanceof OidcError && error.kind === 'invalid_grant') {
        await dependencies.sessions.delete(sid);
        throw new AuthPublicError('SESSION_INVALID');
      }
      if (error instanceof AuthPublicError) throw error;
      throw new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
    } finally {
      await dependencies.sessions
        .releaseRefreshLock(sid, owner)
        .catch(() => undefined);
    }
  }

  private oidcSessionId(
    ...payloads: Array<JWTPayload | undefined>
  ): string | undefined {
    let expected: string | undefined;
    for (const payload of payloads) {
      if (!payload || payload.sid === undefined) continue;
      if (
        typeof payload.sid !== 'string' ||
        !payload.sid ||
        payload.sid.length > 512 ||
        (expected !== undefined && expected !== payload.sid)
      )
        throw new OidcError('invalid_response');
      expected = payload.sid;
    }
    return expected;
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
