/// <reference types="jest" />
import { JWTPayload } from 'jose';
import { createBrowserBinding, createState } from './crypto';
import { WebAuthPublicError } from './errors/web-auth.errors';
import { KeycloakClient, OidcError } from './oidc/keycloak-client';
import { WebStoreUnavailableError } from './redis/web-redis.service';
import { WebSessionStore } from './session/web-session.store';
import { WebSession } from './session/web-session';
import { PendingLoginStore } from './state/pending-login.store';
import { WebAuthConfig } from './web-auth.config';
import { WebAuthService } from './web-auth.service';

const config = {
  enabled: true,
  environment: 'test',
  issuer: 'https://id.test/realms/muserpol',
  hubClientId: 'hub',
  callbackUrl: 'https://hub.test/api/auth/callback',
  sessionTtlSeconds: 28_800,
  sessionIdleTtlSeconds: 7_200,
  refreshSkewSeconds: 120,
} as WebAuthConfig;

const state = createState();
const binding = createBrowserBinding();
const sid = createState();
const nonce = createState();
const nowSeconds = Math.floor(Date.now() / 1000);

function publicCode(error: unknown): string | undefined {
  return error instanceof WebAuthPublicError ? error.code : undefined;
}

describe('WebAuthService', () => {
  let oidc: jest.Mocked<
    Pick<
      KeycloakClient,
      | 'authorizationUrl'
      | 'exchangeAuthorizationCode'
      | 'validateAccessToken'
      | 'validateIdToken'
      | 'refreshPrimaryToken'
      | 'validateRefreshedIdToken'
    >
  >;
  let pending: jest.Mocked<Pick<PendingLoginStore, 'create' | 'take'>>;
  let sessions: jest.Mocked<
    Pick<
      WebSessionStore,
      | 'create'
      | 'get'
      | 'replace'
      | 'delete'
      | 'acquireRefreshLock'
      | 'releaseRefreshLock'
      | 'waitForRevision'
    >
  >;
  let service: WebAuthService;

  beforeEach(() => {
    oidc = {
      authorizationUrl: jest
        .fn()
        .mockResolvedValue(`https://id.test/authorize?state=${state}`),
      exchangeAuthorizationCode: jest.fn().mockResolvedValue({
        access_token: 'access-token',
        id_token: 'id-token',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        expires_in: 300,
      }),
      validateAccessToken: jest.fn().mockResolvedValue({
        sub: 'person-1',
        exp: nowSeconds + 300,
      } as JWTPayload),
      validateIdToken: jest.fn().mockResolvedValue({
        sub: 'person-1',
        exp: nowSeconds + 300,
        preferred_username: 'person',
        name: 'Test Person',
        given_name: 'Test',
        family_name: 'Person',
        email: 'person@example.test',
        roles: ['must-not-leak'],
        groups: ['must-not-leak'],
      } as JWTPayload),
      refreshPrimaryToken: jest.fn().mockResolvedValue({
        access_token: 'refreshed-access-token',
        refresh_token: 'refreshed-refresh-token',
        id_token: 'refreshed-id-token',
        token_type: 'Bearer',
        expires_in: 300,
      }),
      validateRefreshedIdToken: jest.fn().mockResolvedValue({
        sub: 'person-1',
        exp: nowSeconds + 300,
        name: 'Test Person',
      } as JWTPayload),
    };
    pending = {
      create: jest.fn().mockResolvedValue(undefined),
      take: jest.fn().mockResolvedValue({
        clientId: 'hub',
        codeVerifier: createState(),
        nonce,
        redirectUri: config.callbackUrl,
        returnTo: '/apphub/reports?page=2',
        browserBindingHash: 'a'.repeat(64),
        createdAt: Date.now(),
      }),
    };
    sessions = {
      create: jest.fn().mockResolvedValue(sid),
      get: jest.fn(),
      replace: jest.fn().mockResolvedValue(true),
      delete: jest.fn().mockResolvedValue(undefined),
      acquireRefreshLock: jest.fn().mockResolvedValue('lock-owner'),
      releaseRefreshLock: jest.fn().mockResolvedValue(undefined),
      waitForRevision: jest.fn(),
    };
    service = new WebAuthService(
      config,
      oidc as unknown as KeycloakClient,
      pending as unknown as PendingLoginStore,
      sessions as unknown as WebSessionStore,
    );
  });

  function sessionFixture(overrides: Partial<WebSession> = {}): WebSession {
    const now = Date.now();
    return {
      schemaVersion: 2,
      revision: 1,
      status: 'active',
      subject: 'person-1',
      issuer: config.issuer,
      hubClientId: config.hubClientId,
      createdAt: now - 1_000,
      absoluteExpiresAt: now + 28_799_000,
      idleExpiresAt: now + 7_199_000,
      lastActivityAt: now - 1_000,
      identity: { sub: 'person-1', name: 'Test Person' },
      primary: {
        tokenType: 'Bearer',
        accessToken: 'hidden-current-access',
        refreshToken: 'hidden-current-refresh',
        idToken: 'hidden-current-id',
        idExpiresAt: now + 300_000,
        issuedAt: now - 1_000,
        accessExpiresAt: now + 300_000,
      },
      clients: {},
      ...overrides,
    };
  }

  it('starts login with state, nonce, PKCE and only a binding hash', async () => {
    const result = await service.start({
      returnPath: '/apphub?view=summary',
      browserBinding: binding,
    });
    expect(result).toEqual({
      authorizationUrl: expect.stringMatching(/^https:\/\/id\.test\/authorize/),
    });
    expect(pending.create).toHaveBeenCalledWith(
      expect.stringMatching(/^[A-Za-z0-9_-]{43,128}$/),
      expect.objectContaining({
        clientId: 'hub',
        returnTo: '/apphub?view=summary',
        codeVerifier: expect.stringMatching(/^[A-Za-z0-9._~-]{43,128}$/),
        nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43,128}$/),
        browserBindingHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const stored = pending.create.mock.calls[0][1];
    expect(stored.browserBindingHash).not.toBe(binding);
    expect(JSON.stringify(stored)).not.toContain(binding);
    expect(oidc.authorizationUrl).toHaveBeenCalledWith({
      state: expect.any(String),
      nonce: stored.nonce,
      codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
  });

  it('rejects malformed start requests without touching the stores', async () => {
    await expect(
      service.start({ returnPath: '/outside', browserBinding: binding }),
    ).rejects.toMatchObject({ code: 'INVALID_LOGIN_REQUEST' });
    await expect(
      service.start({ returnPath: '/apphub', browserBinding: 'short' }),
    ).rejects.toMatchObject({ code: 'INVALID_LOGIN_REQUEST' });
    expect(pending.create).not.toHaveBeenCalled();
  });

  it('exchanges and verifies tokens, creates a fresh session and minimizes identity', async () => {
    const result = await service.exchange({
      code: 'code',
      state,
      browserBinding: binding,
    });
    expect(pending.take).toHaveBeenCalledWith(state, binding);
    expect(oidc.validateIdToken).toHaveBeenCalledWith('id-token', nonce);
    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'person-1',
        identity: {
          sub: 'person-1',
          preferredUsername: 'person',
          name: 'Test Person',
          givenName: 'Test',
          familyName: 'Person',
          email: 'person@example.test',
        },
        schemaVersion: 2,
        revision: 1,
        status: 'active',
        clients: {},
        primary: expect.objectContaining({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
        }),
      }),
    );
    expect(result.sid).toBe(sid);
    expect(result.returnPath).toBe('/apphub/reports?page=2');
    const stored = sessions.create.mock.calls[0][0];
    expect(result.sessionExpiresAt).toBe(stored.idleExpiresAt);
    expect(result.sessionAbsoluteExpiresAt).toBe(stored.absoluteExpiresAt);
    expect(Number.isSafeInteger(result.sessionExpiresAt)).toBe(true);
    expect(Number.isSafeInteger(result.sessionAbsoluteExpiresAt)).toBe(true);
    expect(result.identity).not.toHaveProperty('roles');
    expect(result.identity).not.toHaveProperty('groups');
    expect(result).not.toHaveProperty('accessToken');
    expect(stored.absoluteExpiresAt - stored.createdAt).toBe(28_800_000);
    expect(stored.idleExpiresAt - stored.createdAt).toBe(7_200_000);
    expect(stored.primary.accessExpiresAt).toBeLessThan(
      stored.absoluteExpiresAt,
    );
  });

  it.each([
    ['token endpoint', 'exchangeAuthorizationCode'],
    ['access token', 'validateAccessToken'],
    ['ID token nonce', 'validateIdToken'],
  ] as const)(
    'returns one public OIDC error for a %s failure',
    async (_label, method) => {
      oidc[method].mockRejectedValueOnce(new OidcError());
      await expect(
        service.exchange({ code: 'code', state, browserBinding: binding }),
      ).rejects.toMatchObject({ code: 'OIDC_LOGIN_FAILED' });
      expect(sessions.create).not.toHaveBeenCalled();
    },
  );

  it('returns a uniform state error for unavailable, expired, reused or wrong-binding state', async () => {
    pending.take.mockRejectedValueOnce(
      new (await import('./state/pending-login.store')).PendingLoginError(),
    );
    await expect(
      service.exchange({ code: 'code', state, browserBinding: binding }),
    ).rejects.toMatchObject({ code: 'LOGIN_STATE_INVALID' });
  });

  it('checks a valid session without returning tokens', async () => {
    sessions.get.mockResolvedValueOnce({
      schemaVersion: 2,
      revision: 1,
      status: 'active',
      subject: 'person-1',
      issuer: config.issuer,
      hubClientId: 'hub',
      createdAt: Date.now() - 1000,
      absoluteExpiresAt: Date.now() + 28_800_000,
      idleExpiresAt: Date.now() + 7_200_000,
      lastActivityAt: Date.now() - 1000,
      identity: { sub: 'person-1', name: 'Test Person' },
      primary: {
        tokenType: 'Bearer',
        accessToken: 'hidden',
        issuedAt: Date.now() - 1000,
        accessExpiresAt: Date.now() + 300_000,
      },
      clients: {},
    });
    const result = await service.check({ sid });
    expect(result).toEqual({
      authenticated: true,
      identity: { sub: 'person-1', name: 'Test Person' },
      sessionExpiresAt: expect.any(Number),
    });
    expect(JSON.stringify(result)).not.toContain('hidden');
  });

  it('records authenticated activity without refreshing far from expiry', async () => {
    const current = sessionFixture();
    sessions.get.mockResolvedValueOnce(current);
    await expect(service.check({ sid })).resolves.toMatchObject({
      authenticated: true,
      identity: current.identity,
    });
    expect(oidc.refreshPrimaryToken).not.toHaveBeenCalled();
    expect(sessions.replace).toHaveBeenCalledWith(
      sid,
      current.revision,
      expect.objectContaining({
        revision: 2,
        lastActivityAt: expect.any(Number),
      }),
    );
  });

  it('refreshes and atomically replaces the primary context inside the margin', async () => {
    const current = sessionFixture({
      primary: {
        ...sessionFixture().primary,
        accessExpiresAt: Date.now() + 60_000,
      },
    });
    sessions.get.mockResolvedValue(current);
    const result = await service.check({ sid });
    expect(oidc.refreshPrimaryToken).toHaveBeenCalledWith(
      'hidden-current-refresh',
    );
    expect(oidc.validateAccessToken).toHaveBeenCalledWith(
      'refreshed-access-token',
    );
    expect(oidc.validateRefreshedIdToken).toHaveBeenCalledWith(
      'refreshed-id-token',
    );
    expect(sessions.replace).toHaveBeenCalledWith(
      sid,
      1,
      expect.objectContaining({
        revision: 2,
        primary: expect.objectContaining({
          accessToken: 'refreshed-access-token',
          refreshToken: 'refreshed-refresh-token',
        }),
      }),
    );
    const refreshed = sessions.replace.mock.calls[0][2];
    expect(refreshed.primary.idToken).toBe('refreshed-id-token');
    expect(refreshed.primary.idExpiresAt).toEqual(expect.any(Number));
    expect(refreshed.primary.idExpiresAt).toBeGreaterThan(Date.now());
    expect(JSON.stringify(result)).not.toContain('refreshed-access-token');
  });

  it('keeps valid optional refresh and ID tokens when Keycloak omits replacements', async () => {
    const current = sessionFixture({
      primary: {
        ...sessionFixture().primary,
        accessExpiresAt: Date.now() + 60_000,
      },
    });
    sessions.get.mockResolvedValue(current);
    oidc.refreshPrimaryToken.mockResolvedValueOnce({
      access_token: 'refreshed-access-token',
      token_type: 'Bearer',
      expires_in: 300,
    });
    await service.check({ sid });
    const replacement = sessions.replace.mock.calls[0][2];
    expect(replacement.primary).toMatchObject({
      refreshToken: 'hidden-current-refresh',
      idToken: 'hidden-current-id',
      idExpiresAt: current.primary.idExpiresAt,
    });
    expect(oidc.validateRefreshedIdToken).not.toHaveBeenCalled();
  });

  it('does not retain an expired ID token when refresh omits id_token', async () => {
    const current = sessionFixture({
      primary: {
        ...sessionFixture().primary,
        accessExpiresAt: Date.now() + 60_000,
        idExpiresAt: Date.now() - 1,
      },
    });
    sessions.get.mockResolvedValue(current);
    oidc.refreshPrimaryToken.mockResolvedValueOnce({
      access_token: 'refreshed-access-token',
      token_type: 'Bearer',
      expires_in: 300,
    });
    await service.check({ sid });
    const replacement = sessions.replace.mock.calls[0][2];
    expect(replacement.primary).not.toHaveProperty('idToken');
    expect(replacement.primary).not.toHaveProperty('idExpiresAt');
    expect(replacement.primary.refreshToken).toBe('hidden-current-refresh');
  });

  it('waits for and uses the refresh winner when another request owns the lock', async () => {
    const current = sessionFixture({
      primary: {
        ...sessionFixture().primary,
        accessExpiresAt: Date.now() + 60_000,
      },
    });
    const winner = sessionFixture({
      revision: 2,
      primary: {
        ...current.primary,
        accessToken: 'winner-access',
        accessExpiresAt: Date.now() + 300_000,
      },
    });
    sessions.get.mockResolvedValueOnce(current);
    sessions.acquireRefreshLock.mockResolvedValueOnce(undefined);
    sessions.waitForRevision.mockResolvedValueOnce(winner);
    await expect(service.check({ sid })).resolves.toMatchObject({
      authenticated: true,
    });
    expect(sessions.waitForRevision).toHaveBeenCalledWith(sid, 1);
    expect(oidc.refreshPrimaryToken).not.toHaveBeenCalled();
  });

  it('never accepts an expired unchanged winner and retries refresh once', async () => {
    const current = sessionFixture({
      primary: {
        ...sessionFixture().primary,
        accessExpiresAt: Date.now() + 60_000,
      },
    });
    const staleWinner = sessionFixture({
      revision: 2,
      primary: {
        ...current.primary,
        accessExpiresAt: Date.now() - 1,
      },
    });
    sessions.get
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(staleWinner);
    sessions.acquireRefreshLock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('second-owner');
    sessions.waitForRevision.mockResolvedValueOnce(staleWinner);
    await expect(service.check({ sid })).resolves.toMatchObject({
      authenticated: true,
    });
    expect(oidc.refreshPrimaryToken).toHaveBeenCalledTimes(1);
    expect(sessions.acquireRefreshLock).toHaveBeenCalledTimes(2);
  });

  it('re-reads and uses the winner after losing the revision update', async () => {
    const current = sessionFixture({
      primary: {
        ...sessionFixture().primary,
        accessExpiresAt: Date.now() + 60_000,
      },
    });
    const winner = sessionFixture({ revision: 2 });
    sessions.get
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(winner);
    sessions.replace.mockResolvedValueOnce(false);
    await expect(service.check({ sid })).resolves.toMatchObject({
      authenticated: true,
    });
    expect(sessions.get).toHaveBeenCalledTimes(3);
  });

  it('invalidates the complete session after invalid_grant', async () => {
    const current = sessionFixture({
      primary: {
        ...sessionFixture().primary,
        accessExpiresAt: Date.now() + 60_000,
      },
    });
    sessions.get.mockResolvedValue(current);
    oidc.refreshPrimaryToken.mockRejectedValueOnce(
      new OidcError('invalid_grant'),
    );
    await expect(service.check({ sid })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
    expect(sessions.delete).toHaveBeenCalledWith(sid);
  });

  it.each([
    ['Keycloak timeout', new OidcError('unavailable')],
    ['malformed token response', new OidcError('invalid_response')],
    ['unknown error', new Error('internal details must remain hidden')],
  ])('preserves the session for %s', async (_label, failure) => {
    const current = sessionFixture({
      primary: {
        ...sessionFixture().primary,
        accessExpiresAt: Date.now() + 60_000,
      },
    });
    sessions.get.mockResolvedValue(current);
    oidc.refreshPrimaryToken.mockRejectedValueOnce(failure);
    await expect(service.check({ sid })).rejects.toMatchObject({
      code: 'AUTH_SERVICE_UNAVAILABLE',
      message: 'Authentication service is unavailable',
    });
    expect(sessions.delete).not.toHaveBeenCalled();
    expect(sessions.replace).not.toHaveBeenCalled();
  });

  it.each(['subject', 'issuer', 'client'])(
    'does not replace tokens when the refreshed %s is invalid',
    async (invalidPart) => {
      const current = sessionFixture({
        primary: {
          ...sessionFixture().primary,
          accessExpiresAt: Date.now() + 60_000,
        },
      });
      sessions.get.mockResolvedValue(current);
      if (invalidPart === 'subject') {
        oidc.validateAccessToken.mockResolvedValueOnce({
          sub: 'different-person',
          exp: nowSeconds + 300,
        } as JWTPayload);
      } else {
        oidc.validateAccessToken.mockRejectedValueOnce(
          new OidcError('invalid_response'),
        );
      }
      await expect(service.check({ sid })).rejects.toMatchObject({
        code: 'AUTH_SERVICE_UNAVAILABLE',
      });
      expect(sessions.replace).not.toHaveBeenCalled();
      expect(sessions.delete).not.toHaveBeenCalled();
    },
  );

  it('does not log session or token material during refresh failures', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation();
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const log = jest.spyOn(console, 'log').mockImplementation();
    const current = sessionFixture({
      primary: {
        ...sessionFixture().primary,
        accessExpiresAt: Date.now() + 60_000,
      },
    });
    sessions.get.mockResolvedValue(current);
    oidc.refreshPrimaryToken.mockRejectedValueOnce(
      new OidcError('unavailable'),
    );
    await expect(service.check({ sid })).rejects.toBeDefined();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
    log.mockRestore();
  });

  it('uses the same public response for malformed and missing sessions', async () => {
    try {
      await service.check({ sid: 'bad' });
      throw new Error('expected session rejection');
    } catch (error) {
      expect(publicCode(error)).toBe('SESSION_INVALID');
    }
    sessions.get.mockRejectedValueOnce(new Error('missing'));
    await expect(service.check({ sid })).rejects.toMatchObject({
      code: 'SESSION_INVALID',
      message: 'Session is invalid or expired',
    });
  });

  it('maps Redis unavailability during a web operation', async () => {
    pending.create.mockRejectedValueOnce(new WebStoreUnavailableError());
    await expect(
      service.start({ returnPath: '/apphub', browserBinding: binding }),
    ).rejects.toMatchObject({ code: 'AUTH_SERVICE_UNAVAILABLE' });
  });

  it('does not authorize a session when Redis is unavailable', async () => {
    sessions.get.mockRejectedValueOnce(new WebStoreUnavailableError());
    await expect(service.check({ sid })).rejects.toMatchObject({
      code: 'AUTH_SERVICE_UNAVAILABLE',
      message: 'Authentication service is unavailable',
    });
    expect(oidc.refreshPrimaryToken).not.toHaveBeenCalled();
  });

  it('returns WEB_AUTH_DISABLED without web dependencies', async () => {
    const disabled = new WebAuthService(null);
    await expect(
      disabled.start({ returnPath: '/apphub', browserBinding: binding }),
    ).rejects.toMatchObject({ code: 'WEB_AUTH_DISABLED' });
  });
});
