/// <reference types="jest" />
import { WebAuthPublicError } from './errors/web-auth.errors';
import {
  ExchangedWebClientToken,
  KeycloakClient,
  OidcError,
} from './oidc/keycloak-client';
import { WebClientContext, WebSession } from './session/web-session';
import { WebSessionError, WebSessionStore } from './session/web-session.store';
import { PendingLoginStore } from './state/pending-login.store';
import { WebAuthConfig } from './web-auth.config';
import { WebAuthService } from './web-auth.service';
import { parseWebClientCatalog, resolveWebTool } from './web-client-catalog';

const sid = 's'.repeat(43);
const catalog = parseWebClientCatalog(
  JSON.stringify({
    beneficiary: {
      clientId: 'beneficiary-interface',
      audience: 'beneficiary-interface',
      resourceServer: 'beneficiary-interface',
    },
    'test-tool': {
      clientId: 'test-interface',
      audience: 'test-interface',
      resourceServer: 'test-interface',
    },
  }),
  'hub-interface',
);
const config = {
  enabled: true,
  environment: 'test',
  issuer: 'https://id.test/realms/muserpol',
  hubClientId: 'hub-interface',
  sessionTtlSeconds: 28_800,
  sessionIdleTtlSeconds: 7_200,
  refreshSkewSeconds: 120,
  clientCatalog: catalog,
  resolveWebTool: (tool: string) => resolveWebTool(catalog, tool),
} as WebAuthConfig;

function sessionFixture(overrides: Partial<WebSession> = {}): WebSession {
  const now = Date.now();
  return {
    schemaVersion: 2,
    revision: 4,
    status: 'active',
    subject: 'person-1',
    issuer: config.issuer,
    hubClientId: config.hubClientId,
    createdAt: now - 10_000,
    absoluteExpiresAt: now + 20_000_000,
    idleExpiresAt: now + 7_000_000,
    lastActivityAt: now - 1_000,
    identity: { sub: 'person-1', name: 'Test Person' },
    primary: {
      tokenType: 'Bearer',
      accessToken: 'primary-token',
      refreshToken: 'primary-refresh',
      issuedAt: now - 1_000,
      accessExpiresAt: now + 300_000,
    },
    clients: {},
    ...overrides,
  };
}

function exchanged(overrides: Partial<ExchangedWebClientToken> = {}) {
  const now = Date.now();
  return {
    accessToken: 'secondary-token',
    tokenType: 'Bearer' as const,
    expiresIn: 300,
    expiresAt: now + 300_000,
    claims: {
      subject: 'person-1',
      issuer: config.issuer,
      audience: ['beneficiary-interface'],
      azp: 'hub-interface',
      sid: 'keycloak-session',
      realmRoles: ['member'],
      clientRoles: ['read'],
      groups: ['/beneficiary'],
      expiresAt: now + 300_000,
    },
    ...overrides,
  } satisfies ExchangedWebClientToken;
}

function contextFixture(overrides: Partial<WebClientContext> = {}) {
  const result = exchanged();
  return {
    tool: 'beneficiary',
    clientId: 'beneficiary-interface',
    audience: 'beneficiary-interface',
    resourceServer: 'beneficiary-interface',
    source: 'token-exchange' as const,
    tokens: {
      tokenType: 'Bearer' as const,
      accessToken: result.accessToken,
      accessExpiresAt: result.expiresAt,
      issuedAt: Date.now(),
    },
    subject: 'person-1',
    issuer: config.issuer,
    azp: 'hub-interface',
    keycloakSessionId: 'keycloak-session',
    realmRoles: ['member'],
    clientRoles: ['read'],
    groups: ['/beneficiary'],
    ...overrides,
  } satisfies WebClientContext;
}

describe('WebAuthService client context coordination', () => {
  let current: WebSession;
  let oidc: jest.Mocked<
    Pick<
      KeycloakClient,
      | 'exchangeWebClientToken'
      | 'refreshPrimaryToken'
      | 'validateAccessToken'
      | 'validateRefreshedIdToken'
    >
  >;
  let sessions: jest.Mocked<
    Pick<
      WebSessionStore,
      | 'get'
      | 'replace'
      | 'delete'
      | 'acquireRefreshLock'
      | 'releaseRefreshLock'
      | 'waitForRevision'
      | 'acquireClientLock'
      | 'releaseClientLock'
      | 'replaceClientContext'
    >
  >;
  let service: WebAuthService;

  beforeEach(() => {
    current = sessionFixture();
    oidc = {
      exchangeWebClientToken: jest.fn().mockResolvedValue(exchanged()),
      refreshPrimaryToken: jest.fn().mockResolvedValue({
        access_token: 'renewed-primary',
        refresh_token: 'renewed-refresh',
        token_type: 'Bearer',
        expires_in: 300,
      }),
      validateAccessToken: jest.fn().mockResolvedValue({
        sub: 'person-1',
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
      validateRefreshedIdToken: jest.fn(),
    };
    sessions = {
      get: jest.fn().mockImplementation(async () => current),
      replace: jest.fn().mockImplementation(async (_sid, revision, next) => {
        if (revision !== current.revision) return false;
        current = next;
        return true;
      }),
      delete: jest.fn().mockResolvedValue(undefined),
      acquireRefreshLock: jest.fn().mockResolvedValue('primary-owner'),
      releaseRefreshLock: jest.fn().mockResolvedValue(undefined),
      waitForRevision: jest.fn(),
      acquireClientLock: jest.fn().mockResolvedValue('client-owner'),
      releaseClientLock: jest.fn().mockResolvedValue(undefined),
      replaceClientContext: jest
        .fn()
        .mockImplementation(
          async (_sid, revision, tool, context, _owner, now) => {
            if (revision !== current.revision) return 'revision_mismatch';
            current = {
              ...current,
              revision: current.revision + 1,
              lastActivityAt: now,
              idleExpiresAt: Math.min(
                current.absoluteExpiresAt,
                now + config.sessionIdleTtlSeconds * 1000,
              ),
              clients: { ...current.clients, [tool]: context },
            };
            return 'updated';
          },
        ),
    };
    service = new WebAuthService(
      config,
      oidc as unknown as KeycloakClient,
      {} as PendingLoginStore,
      sessions as unknown as WebSessionStore,
    );
  });

  async function ensure(tool = 'beneficiary') {
    return service.ensureWebClientContext({ sid, tool });
  }

  it('creates and persists the initial context without exposing tokens', async () => {
    const result = await ensure();
    expect(oidc.exchangeWebClientToken).toHaveBeenCalledWith({
      subjectToken: 'primary-token',
      expectedSubject: 'person-1',
      target: config.resolveWebTool('beneficiary'),
    });
    expect(sessions.replaceClientContext).toHaveBeenCalledWith(
      sid,
      4,
      'beneficiary',
      expect.objectContaining({
        tool: 'beneficiary',
        clientId: 'beneficiary-interface',
        resourceServer: 'beneficiary-interface',
        subject: 'person-1',
        tokens: expect.objectContaining({
          accessToken: 'secondary-token',
          accessExpiresAt: expect.any(Number),
        }),
      }),
      'client-owner',
      expect.any(Number),
    );
    expect(result).toEqual({
      authenticated: true,
      currentTool: 'beneficiary',
      currentClient: 'beneficiary-interface',
      identity: current.identity,
      realmRoles: ['member'],
      clientRoles: ['read'],
      groups: ['/beneficiary'],
      contextExpiresAt: expect.any(Number),
      sessionExpiresAt: expect.any(Number),
      sessionAbsoluteExpiresAt: current.absoluteExpiresAt,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /secondary-token|primary-token|keycloak-session|resourceServer|sid/i,
    );
  });

  it('reuses a context outside the refresh margin without another exchange', async () => {
    current.clients.beneficiary = contextFixture();
    await ensure();
    expect(oidc.exchangeWebClientToken).not.toHaveBeenCalled();
    expect(sessions.replaceClientContext).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['inside the margin', Date.now() + 60_000],
    ['expired', Date.now() - 1],
  ])('re-exchanges a context %s', async (_label, accessExpiresAt) => {
    current.clients.beneficiary = contextFixture({
      tokens: { ...contextFixture().tokens, accessExpiresAt },
    });
    await ensure();
    expect(oidc.exchangeWebClientToken).toHaveBeenCalledTimes(1);
  });

  it('replaces a context that no longer matches the catalog', async () => {
    current.clients.beneficiary = contextFixture({
      audience: 'old-beneficiary-audience',
    });
    await ensure();
    expect(oidc.exchangeWebClientToken).toHaveBeenCalledTimes(1);
    expect(sessions.replaceClientContext).toHaveBeenCalledWith(
      sid,
      expect.any(Number),
      'beneficiary',
      expect.objectContaining({ audience: 'beneficiary-interface' }),
      'client-owner',
      expect.any(Number),
    );
  });

  it.each([
    ['closing', new WebSessionError()],
    ['expired', new WebSessionError()],
  ])('returns a session error for a %s session', async (_label, error) => {
    sessions.get.mockRejectedValueOnce(error);
    await expect(ensure()).rejects.toMatchObject({ code: 'SESSION_INVALID' });
    expect(oidc.exchangeWebClientToken).not.toHaveBeenCalled();
  });

  it('rejects malformed and unknown tools without touching the session', async () => {
    await expect(ensure('../beneficiary')).rejects.toMatchObject({
      code: 'INVALID_CLIENT_REQUEST',
    });
    await expect(ensure('unknown')).rejects.toMatchObject({
      code: 'WEB_TOOL_UNAVAILABLE',
    });
    expect(sessions.get).not.toHaveBeenCalled();
  });

  it('uses a valid winner after losing the revision', async () => {
    const winnerContext = contextFixture();
    sessions.replaceClientContext.mockResolvedValueOnce('revision_mismatch');
    sessions.get
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(
        sessionFixture({
          revision: 5,
          clients: { beneficiary: winnerContext },
        }),
      );
    const result = await ensure();
    expect(result.currentClient).toBe('beneficiary-interface');
    expect(oidc.exchangeWebClientToken).toHaveBeenCalledTimes(1);
    expect(sessions.replaceClientContext).toHaveBeenCalledTimes(1);
  });

  it('retries a bounded CAS when the revision winner is not usable', async () => {
    const invalidWinner = sessionFixture({
      revision: 5,
      clients: {
        beneficiary: contextFixture({ audience: 'old-audience' }),
      },
    });
    sessions.replaceClientContext
      .mockResolvedValueOnce('revision_mismatch')
      .mockResolvedValueOnce('updated');
    sessions.get
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(invalidWinner);
    await expect(ensure()).resolves.toMatchObject({ authenticated: true });
    expect(sessions.replaceClientContext).toHaveBeenCalledTimes(2);
    expect(oidc.exchangeWebClientToken).toHaveBeenCalledTimes(1);
  });

  it('waits and retries when another request owns the tool lock', async () => {
    const winner = sessionFixture({
      revision: 5,
      clients: { beneficiary: contextFixture() },
    });
    sessions.acquireClientLock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('second-owner');
    sessions.waitForRevision.mockResolvedValueOnce(winner);
    sessions.get
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(winner)
      .mockResolvedValueOnce(winner);
    await ensure();
    expect(oidc.exchangeWebClientToken).not.toHaveBeenCalled();
    expect(sessions.acquireClientLock).toHaveBeenCalledTimes(2);
  });

  it('runs one exchange for two concurrent requests for the same tool', async () => {
    let lockHeld = false;
    let finishExchange!: (value: ExchangedWebClientToken) => void;
    let contextPersisted!: () => void;
    const exchangeResult = new Promise<ExchangedWebClientToken>((resolve) => {
      finishExchange = resolve;
    });
    const persisted = new Promise<void>((resolve) => {
      contextPersisted = resolve;
    });
    oidc.exchangeWebClientToken.mockReturnValueOnce(exchangeResult);
    sessions.acquireClientLock.mockImplementation(async () => {
      if (lockHeld) return undefined;
      lockHeld = true;
      return 'concurrent-owner';
    });
    sessions.releaseClientLock.mockImplementation(async () => {
      lockHeld = false;
    });
    sessions.waitForRevision.mockImplementation(async () => {
      await persisted;
      return current;
    });
    const persist = sessions.replaceClientContext.getMockImplementation()!;
    sessions.replaceClientContext.mockImplementation(async (...args) => {
      const result = await persist(...args);
      contextPersisted();
      return result;
    });

    const first = ensure();
    while (!oidc.exchangeWebClientToken.mock.calls.length)
      await Promise.resolve();
    const second = ensure();
    finishExchange(exchanged());
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(oidc.exchangeWebClientToken).toHaveBeenCalledTimes(1);
  });

  it('does not persist after losing the lock and retries with a new owner', async () => {
    sessions.replaceClientContext
      .mockResolvedValueOnce('lock_lost')
      .mockResolvedValueOnce('updated');
    sessions.acquireClientLock
      .mockResolvedValueOnce('expired-owner')
      .mockResolvedValueOnce('new-owner');
    await expect(ensure()).resolves.toMatchObject({ authenticated: true });
    expect(sessions.releaseClientLock).toHaveBeenCalledWith(
      sid,
      'beneficiary',
      'expired-owner',
    );
    expect(sessions.replaceClientContext).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'temporary failure',
      new OidcError('unavailable'),
      'AUTH_SERVICE_UNAVAILABLE',
    ],
    [
      'access denied',
      new OidcError('access_denied'),
      'WEB_CLIENT_ACCESS_DENIED',
    ],
    ['invalid target', new OidcError('invalid_target'), 'WEB_TOOL_UNAVAILABLE'],
    ['invalid token', new OidcError('invalid_token'), 'WEB_CLIENT_INVALID'],
  ])('preserves primary and activity after %s', async (_label, error, code) => {
    oidc.exchangeWebClientToken.mockRejectedValueOnce(error);
    const previousActivity = current.lastActivityAt;
    await expect(ensure()).rejects.toMatchObject({ code });
    expect(sessions.delete).not.toHaveBeenCalled();
    expect(sessions.replaceClientContext).not.toHaveBeenCalled();
    expect(current.lastActivityAt).toBe(previousActivity);
  });

  it('invalidates globally only when invalid_grant proves primary unrecoverable', async () => {
    oidc.exchangeWebClientToken.mockRejectedValueOnce(
      new OidcError('invalid_grant'),
    );
    oidc.refreshPrimaryToken.mockRejectedValueOnce(
      new OidcError('invalid_grant'),
    );
    await expect(ensure()).rejects.toMatchObject({ code: 'SESSION_INVALID' });
    expect(sessions.delete).toHaveBeenCalledWith(sid);
  });

  it('recovers primary after exchange invalid_grant and retries safely', async () => {
    oidc.exchangeWebClientToken
      .mockRejectedValueOnce(new OidcError('invalid_grant'))
      .mockResolvedValueOnce(exchanged());
    await expect(ensure()).resolves.toMatchObject({ authenticated: true });
    expect(oidc.refreshPrimaryToken).toHaveBeenCalledTimes(1);
    expect(sessions.delete).not.toHaveBeenCalled();
    expect(oidc.exchangeWebClientToken).toHaveBeenCalledTimes(2);
  });

  it('does not log SID, tools, tokens, roles or groups', async () => {
    const spies = [console.log, console.warn, console.error].map((method) =>
      jest.spyOn(console, method.name as 'log').mockImplementation(),
    );
    await ensure();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });

  it('returns the disabled error without dependencies', async () => {
    const disabled = new WebAuthService(null);
    await expect(
      disabled.ensureWebClientContext({ sid, tool: 'beneficiary' }),
    ).rejects.toBeInstanceOf(WebAuthPublicError);
    await expect(
      disabled.ensureWebClientContext({ sid, tool: 'beneficiary' }),
    ).rejects.toMatchObject({ code: 'WEB_AUTH_DISABLED' });
  });
});
