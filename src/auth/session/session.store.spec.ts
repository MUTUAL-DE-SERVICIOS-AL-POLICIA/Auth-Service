/// <reference types="jest" />
import { RedisService } from '../../common/services/redis.service';
import { AuthConfig } from '../config/auth.config';
import { assertSameIdentity, Session } from './session';
import { SessionStore, SessionWaitTimeoutError } from './session.store';

const config = {
  environment: 'test',
  redisKeyPrefix: 'web',
  sessionTtlSeconds: 28800,
  sessionIdleTtlSeconds: 7200,
  issuer: 'http://localhost/realms/muserpol',
  hubClientId: 'hub',
} as AuthConfig;

describe('SessionStore', () => {
  const entries = new Map<string, string>();
  const client = {
    set: jest.fn(async (key: string, value: string, ..._args: unknown[]) => {
      if (entries.has(key)) return null;
      entries.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => entries.get(key) ?? null),
    del: jest.fn(async (key: string) => (entries.delete(key) ? 1 : 0)),
    sadd: jest.fn(async (_key: string, _value: string) => 1),
    srem: jest.fn(async (_key: string, _value: string) => 1),
    smembers: jest.fn(async (_key: string) => [] as string[]),
    expire: jest.fn(async (_key: string, _seconds: number) => 1),
    eval: jest.fn(
      async (script: string, _keys: number, key: string, ...args: string[]) => {
        if (script.includes('current.clients[ARGV[2]]')) {
          const raw = entries.get(key);
          if (!raw) return 0;
          if (entries.get(args[0]) !== args[6]) return -5;
          const current = JSON.parse(raw);
          if (current.schemaVersion !== 2) return -2;
          if (current.status !== 'active') return -3;
          if (current.revision !== Number(args[1])) return -1;
          const context = JSON.parse(args[3]);
          if (
            context.tool !== args[2] ||
            context.subject !== current.subject ||
            context.issuer !== current.issuer
          )
            return -2;
          const now = Number(args[4]);
          current.clients[args[2]] = context;
          current.revision += 1;
          current.lastActivityAt = now;
          current.idleExpiresAt = Math.min(
            current.absoluteExpiresAt,
            now + Number(args[5]),
          );
          entries.set(key, JSON.stringify(current));
          return 1;
        }
        if (script.includes('current.revision')) {
          const raw = entries.get(key);
          if (!raw) return 0;
          const current = JSON.parse(raw);
          if (current.schemaVersion !== 2) return -2;
          if (current.status !== 'active') return -3;
          if (current.revision !== Number(args[0])) return -1;
          entries.set(key, args[1]);
          return 1;
        }
        if (entries.get(key) === args[0]) {
          entries.delete(key);
          return 1;
        }
        return 0;
      },
    ),
  };
  const redis = {
    execute: (operation: (client: any) => Promise<unknown>) =>
      operation(client),
  } as RedisService;
  const store = new SessionStore(redis, config);
  beforeEach(() => {
    entries.clear();
    jest.clearAllMocks();
  });

  function fixture(): Session {
    const now = Date.now();
    return {
      schemaVersion: 2,
      revision: 1,
      status: 'active',
      subject: 'person-1',
      issuer: config.issuer,
      hubClientId: 'hub',
      createdAt: now,
      absoluteExpiresAt: now + 28_800_000,
      idleExpiresAt: now + 7_200_000,
      lastActivityAt: now,
      identity: { sub: 'person-1', name: 'Test Person' },
      primary: {
        tokenType: 'Bearer',
        accessToken: 'test-token',
        issuedAt: now,
        accessExpiresAt: now + 300_000,
      },
      clients: {},
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
      store.create({ ...session, absoluteExpiresAt: Date.now() - 1 }),
    ).rejects.toThrow();
    await expect(
      store.create({
        ...session,
        identity: { ...session.identity, roles: ['admin'] } as any,
      }),
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

  it('uses the idle limit for Redis TTL without exceeding the absolute limit', async () => {
    const now = Date.now();
    const session = fixture();
    session.createdAt = now;
    session.lastActivityAt = now;
    session.idleExpiresAt = now + 7_200_000;
    session.absoluteExpiresAt = now + 28_800_000;
    await store.create(session);
    expect(client.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'EX',
      expect.any(Number),
      'NX',
    );
    const ttl = client.set.mock.calls[0][3] as number;
    expect(ttl).toBeGreaterThanOrEqual(7_199);
    expect(ttl).toBeLessThanOrEqual(7_200);
  });

  it('rejects legacy sessions and sessions in closing state predictably', async () => {
    const opaqueSid = 'a'.repeat(43);
    const key = `web:test:session:${opaqueSid}`;
    entries.set(
      key,
      JSON.stringify({
        version: 1,
        subject: 'person-1',
        expiresAt: Date.now() + 60_000,
      }),
    );
    await expect(store.get(opaqueSid)).rejects.toBeInstanceOf(Error);

    entries.set(key, JSON.stringify({ ...fixture(), status: 'closing' }));
    await expect(store.get(opaqueSid)).rejects.toBeInstanceOf(Error);

    entries.set(
      key,
      JSON.stringify({ ...fixture(), idleExpiresAt: Date.now() - 1 }),
    );
    await expect(store.get(opaqueSid)).rejects.toBeInstanceOf(Error);

    const expired = fixture();
    expired.absoluteExpiresAt = Date.now() - 1;
    expired.idleExpiresAt = expired.absoluteExpiresAt;
    entries.set(key, JSON.stringify(expired));
    await expect(store.get(opaqueSid)).rejects.toBeInstanceOf(Error);
  });

  it('updates only the expected revision and releases only its own lock', async () => {
    const session = fixture();
    const sid = await store.create(session);
    const next = {
      ...session,
      revision: 2,
      lastActivityAt: session.lastActivityAt + 1,
    };
    await expect(store.replace(sid, 1, next)).resolves.toBe(true);
    await expect(store.replace(sid, 1, { ...next, revision: 2 })).resolves.toBe(
      false,
    );

    const owner = await store.acquireRefreshLock(sid);
    expect(owner).toMatch(/^[A-Za-z0-9_-]+$/);
    await store.releaseRefreshLock(sid, 'different-owner');
    expect(entries.has(`web:test:session:${sid}:refresh-lock`)).toBe(true);
    await store.releaseRefreshLock(sid, owner!);
    expect(entries.has(`web:test:session:${sid}:refresh-lock`)).toBe(false);
  });

  it('waits for a winning revision for a bounded period', async () => {
    const session = fixture();
    const sid = await store.create(session);
    await expect(store.waitForRevision(sid, 1, 1)).rejects.toBeInstanceOf(
      SessionWaitTimeoutError,
    );
  });

  it('locks each tool independently and releases only the matching owner', async () => {
    const sid = await store.create(fixture());
    const beneficiaryOwner = await store.acquireClientLock(sid, 'beneficiary');
    const otherOwner = await store.acquireClientLock(sid, 'test-tool');
    expect(beneficiaryOwner).toBeDefined();
    expect(otherOwner).toBeDefined();
    expect(entries.has(`web:test:session:${sid}:client:beneficiary:lock`)).toBe(
      true,
    );
    expect(entries.has(`web:test:session:${sid}:client:test-tool:lock`)).toBe(
      true,
    );
    await store.releaseClientLock(sid, 'beneficiary', 'wrong-owner');
    expect(entries.has(`web:test:session:${sid}:client:beneficiary:lock`)).toBe(
      true,
    );
    await store.releaseClientLock(sid, 'beneficiary', beneficiaryOwner!);
    expect(entries.has(`web:test:session:${sid}:client:beneficiary:lock`)).toBe(
      false,
    );
    expect(entries.has(`web:test:session:${sid}:client:test-tool:lock`)).toBe(
      true,
    );
  });

  it('indexes and deletes the exact WebSession selected by an OIDC sid', async () => {
    const base = fixture();
    const session: Session = {
      ...base,
      primary: {
        ...base.primary,
        keycloakSessionId: 'keycloak-session-1',
      },
    };
    const sid = await store.create(session);
    expect(client.sadd).toHaveBeenCalledTimes(2);
    client.smembers.mockResolvedValueOnce([sid]);

    await expect(
      store.deleteByOidcSession('keycloak-session-1', session.subject),
    ).resolves.toBe(1);
    expect(client.smembers).toHaveBeenCalledTimes(1);
    expect(entries.has(`web:test:session:${sid}`)).toBe(false);
    expect(client.srem).toHaveBeenCalledTimes(2);
  });

  it('uses the subject index only when the logout token has no OIDC sid', async () => {
    client.smembers.mockResolvedValueOnce([]);

    await expect(
      store.deleteByOidcSession(undefined, 'person-1'),
    ).resolves.toBe(0);
    expect(client.smembers).toHaveBeenCalledTimes(1);
  });

  it('atomically writes a client context, activity, revision and idle TTL', async () => {
    const session = fixture();
    const sid = await store.create(session);
    const now = Date.now();
    const context = {
      tool: 'beneficiary',
      clientId: 'beneficiary-interface',
      audience: 'beneficiary-interface',
      resourceServer: 'beneficiary-interface',
      source: 'token-exchange' as const,
      tokens: {
        tokenType: 'Bearer' as const,
        accessToken: 'secondary-token',
        accessExpiresAt: now + 300_000,
        issuedAt: now,
      },
      subject: session.subject,
      issuer: session.issuer,
      realmRoles: ['member'],
      clientRoles: ['read'],
      groups: ['/beneficiary'],
    };
    await expect(
      store.replaceClientContext(
        sid,
        1,
        'beneficiary',
        context,
        await store.acquireClientLock(sid, 'beneficiary').then((v) => v!),
        now,
      ),
    ).resolves.toBe('updated');
    const stored = await store.get(sid);
    expect(stored).toMatchObject({
      revision: 2,
      lastActivityAt: now,
      clients: { beneficiary: context },
    });
    expect(stored.idleExpiresAt).toBeLessThanOrEqual(stored.absoluteExpiresAt);
    await expect(
      store.replaceClientContext(
        sid,
        1,
        'beneficiary',
        context,
        entries.get(`web:test:session:${sid}:client:beneficiary:lock`)!,
        now,
      ),
    ).resolves.toBe('revision_mismatch');
    await expect(
      store.replaceClientContext(
        sid,
        2,
        'beneficiary',
        context,
        'lost-owner',
        now,
      ),
    ).resolves.toBe('lock_lost');
  });
});
