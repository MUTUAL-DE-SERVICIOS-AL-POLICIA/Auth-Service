/// <reference types="jest" />
import { WebRedisService } from '../redis/web-redis.service';
import { WebAuthConfig } from '../web-auth.config';
import { assertSameIdentity, WebSession } from './web-session';
import { WebSessionStore } from './web-session.store';

const config = {
  environment: 'test',
  redisKeyPrefix: 'web',
  sessionTtlSeconds: 28800,
  issuer: 'http://localhost/realms/muserpol',
  hubClientId: 'hub',
} as WebAuthConfig;

describe('WebSessionStore', () => {
  const entries = new Map<string, string>();
  const client = {
    set: jest.fn(async (key: string, value: string) => {
      if (entries.has(key)) return null;
      entries.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => entries.get(key) ?? null),
    del: jest.fn(async (key: string) => (entries.delete(key) ? 1 : 0)),
  };
  const redis = {
    execute: (operation: (client: any) => Promise<unknown>) =>
      operation(client),
  } as WebRedisService;
  const store = new WebSessionStore(redis, config);
  beforeEach(() => {
    entries.clear();
    jest.clearAllMocks();
  });

  function fixture(): WebSession {
    const now = Date.now();
    return {
      version: 1,
      subject: 'person-1',
      issuer: config.issuer,
      hubClientId: 'hub',
      createdAt: now,
      expiresAt: now + 28_800_000,
      hubTokens: {
        tokenType: 'Bearer',
        accessToken: 'test-token',
        expiresAt: now + 300_000,
      },
    };
  }

  it('creates a new opaque SID with TTL, reads and deletes only stored tokens', async () => {
    const session = fixture();
    const sid = await store.create(session);
    expect(sid).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(client.set).toHaveBeenCalledWith(
      `web:test:session:${sid}`,
      JSON.stringify(session),
      'EX',
      expect.any(Number),
      'NX',
    );
    expect(await store.get(sid)).toEqual(session);
    await store.delete(sid);
    await expect(store.get(sid)).rejects.toThrow();
  });
  it('rejects wrong issuer, expired data and identity changes', async () => {
    const session = fixture();
    await expect(
      store.create({ ...session, issuer: 'other' }),
    ).rejects.toThrow();
    await expect(
      store.create({ ...session, expiresAt: Date.now() - 1 }),
    ).rejects.toThrow();
    for (const change of [
      { subject: 'other' },
      { issuer: 'other' },
      { hubClientId: 'other' },
    ]) {
      expect(() =>
        assertSameIdentity(session, { ...session, ...change }),
      ).toThrow();
    }
  });
  it('retries a collision without overwriting a session', async () => {
    client.set.mockResolvedValueOnce(null);
    await expect(store.create(fixture())).resolves.toBeDefined();
    expect(client.set).toHaveBeenCalledTimes(2);
  });
});
