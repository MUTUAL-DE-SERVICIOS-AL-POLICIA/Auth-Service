/// <reference types="jest" />
import {
  createBrowserBinding,
  createNonce,
  createPkce,
  createState,
  hashBrowserBinding,
} from '../utils/crypto';
import { RedisService } from '../../common/services/redis.service';
import { WebAuthConfig } from '../config/auth.config';
import { PendingLoginStore } from './pending-login.store';

const config = {
  environment: 'test',
  redisKeyPrefix: 'web',
  pendingTtlSeconds: 600,
  hubClientId: 'hub',
  callbackUrl: 'http://localhost/callback',
} as WebAuthConfig;

describe('PendingLoginStore', () => {
  const entries = new Map<string, string>();
  const client = {
    set: jest.fn(async (key: string, value: string) => {
      if (entries.has(key)) return null;
      entries.set(key, value);
      return 'OK';
    }),
    eval: jest.fn(async (_script: string, _count: number, key: string) => {
      const value = entries.get(key) ?? null;
      entries.delete(key);
      return value;
    }),
  };
  const redis = {
    execute: (operation: (client: any) => Promise<unknown>) =>
      operation(client),
  } as RedisService;
  const store = new PendingLoginStore(redis, config);
  beforeEach(() => {
    entries.clear();
    jest.clearAllMocks();
  });

  function fixture(createdAt = Date.now()) {
    const binding = createBrowserBinding();
    return {
      binding,
      pending: {
        clientId: 'hub',
        codeVerifier: createPkce().verifier,
        nonce: createNonce(),
        redirectUri: config.callbackUrl,
        returnTo: '/apphub',
        browserBindingHash: hashBrowserBinding(binding),
        createdAt,
      },
    };
  }

  it('creates once with TTL and consumes once with matching binding', async () => {
    const state = createState();
    const { binding, pending } = fixture();
    await store.create(state, pending);
    expect(client.set).toHaveBeenCalledWith(
      `web:test:pending:${state}`,
      expect.any(String),
      'EX',
      600,
      'NX',
    );
    await expect(store.create(state, pending)).rejects.toThrow();
    await expect(store.take(state, binding)).resolves.toEqual(pending);
    await expect(store.take(state, binding)).rejects.toThrow();
  });
  it('rejects wrong binding, expired claims and corrupt JSON', async () => {
    const a = createState();
    const { pending } = fixture();
    await store.create(a, pending);
    await expect(store.take(a, 'wrong')).rejects.toThrow();
    const b = createState();
    const old = fixture(Date.now() - 601_000);
    await store.create(b, old.pending);
    await expect(store.take(b, old.binding)).rejects.toThrow();
    const c = createState();
    entries.set(`web:test:pending:${c}`, '{broken');
    await expect(store.take(c, 'anything')).rejects.toThrow();
  });
});
