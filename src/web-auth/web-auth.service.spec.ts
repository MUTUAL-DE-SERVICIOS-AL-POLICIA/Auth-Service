/// <reference types="jest" />
import { JWTPayload } from 'jose';
import { createBrowserBinding, createState } from './crypto';
import { WebAuthPublicError } from './errors/web-auth.errors';
import { KeycloakClient, OidcError } from './oidc/keycloak-client';
import { WebStoreUnavailableError } from './redis/web-redis.service';
import { WebSessionStore } from './session/web-session.store';
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
    >
  >;
  let pending: jest.Mocked<Pick<PendingLoginStore, 'create' | 'take'>>;
  let sessions: jest.Mocked<Pick<WebSessionStore, 'create' | 'get'>>;
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
    };
    service = new WebAuthService(
      config,
      oidc as unknown as KeycloakClient,
      pending as unknown as PendingLoginStore,
      sessions as unknown as WebSessionStore,
    );
  });

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
        hubTokens: expect.objectContaining({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          idToken: 'id-token',
        }),
      }),
    );
    expect(result.sid).toBe(sid);
    expect(result.returnPath).toBe('/apphub/reports?page=2');
    expect(result.identity).not.toHaveProperty('roles');
    expect(result.identity).not.toHaveProperty('groups');
    expect(result).not.toHaveProperty('accessToken');
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
      version: 1,
      subject: 'person-1',
      issuer: config.issuer,
      hubClientId: 'hub',
      createdAt: Date.now() - 1000,
      expiresAt: Date.now() + 60_000,
      identity: { sub: 'person-1', name: 'Test Person' },
      hubTokens: {
        tokenType: 'Bearer',
        accessToken: 'hidden',
        expiresAt: Date.now() + 60_000,
      },
    });
    const result = await service.check({ sid });
    expect(result).toEqual({
      authenticated: true,
      identity: { sub: 'person-1', name: 'Test Person' },
      sessionExpiresAt: expect.any(Number),
    });
    expect(JSON.stringify(result)).not.toContain('hidden');
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

  it('returns WEB_AUTH_DISABLED without web dependencies', async () => {
    const disabled = new WebAuthService(null);
    await expect(
      disabled.start({ returnPath: '/apphub', browserBinding: binding }),
    ).rejects.toMatchObject({ code: 'WEB_AUTH_DISABLED' });
  });
});
