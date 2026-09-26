import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { createSid } from '../crypto';
import { RedisService } from '../../common/services/redis.service';
import { AuthConfig } from '../config/auth.config';
import {
  assertSameIdentity,
  isWebClientContext,
  isSession,
  WebClientContext,
  Session,
} from './session';

const REFRESH_LOCK_TTL_MS = 15_000;
const UPDATE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, current = pcall(cjson.decode, raw)
if not ok or current.schemaVersion ~= 2 then return -2 end
if current.status ~= 'active' then return -3 end
if current.revision ~= tonumber(ARGV[1]) then return -1 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
const UPDATE_CLIENT_CONTEXT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
if redis.call('GET', KEYS[2]) ~= ARGV[7] then return -5 end
local ok, current = pcall(cjson.decode, raw)
if not ok or current.schemaVersion ~= 2 then return -2 end
if current.status ~= 'active' then return -3 end
if current.revision ~= tonumber(ARGV[1]) then return -1 end
local contextOk, context = pcall(cjson.decode, ARGV[3])
if not contextOk or context.tool ~= ARGV[2] then return -2 end
if context.subject ~= current.subject or context.issuer ~= current.issuer then return -2 end
local now = tonumber(ARGV[4])
if current.absoluteExpiresAt <= now or current.idleExpiresAt <= now then return -4 end
local nextOk, nextSession = pcall(cjson.decode, ARGV[5])
if not nextOk or nextSession.schemaVersion ~= 2 then return -2 end
if nextSession.status ~= 'active' then return -3 end
if nextSession.revision ~= current.revision + 1 then return -2 end
if nextSession.subject ~= current.subject or nextSession.issuer ~= current.issuer then return -2 end
if nextSession.hubClientId ~= current.hubClientId then return -2 end
if type(nextSession.clients) ~= 'table' then return -2 end
local nextContext = nextSession.clients[ARGV[2]]
if type(nextContext) ~= 'table' or nextContext.tool ~= ARGV[2] then return -2 end
if nextContext.subject ~= current.subject or nextContext.issuer ~= current.issuer then return -2 end
local ttl = tonumber(ARGV[6])
if not ttl or ttl < 1 then return -4 end
redis.call('SET', KEYS[1], ARGV[5], 'EX', ttl)
return 1
`;

export class SessionWaitTimeoutError extends Error {
  constructor() {
    super('Web session update timed out');
  }
}

export class SessionError extends Error {
  constructor() {
    super('Web session unavailable or invalid');
  }
}

export type ClientContextUpdateResult =
  'updated' | 'revision_mismatch' | 'lock_lost';

@Injectable()
export class SessionStore {
  constructor(
    private readonly redis: RedisService,
    private readonly config: AuthConfig,
  ) {}

  private key(sid: string): string {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(sid)) throw new SessionError();
    return `${this.config.redisKeyPrefix}:${this.config.environment}:session:${sid}`;
  }

  private lockKey(sid: string): string {
    return `${this.key(sid)}:refresh-lock`;
  }

  private indexKey(kind: 'sid' | 'sub', value: string): string {
    if (!value || value.length > 512) throw new SessionError();
    const digest = createHash('sha256').update(value).digest('base64url');
    return `${this.config.redisKeyPrefix}:${this.config.environment}:oidc:${kind}:${digest}`;
  }

  private sessionIndexKeys(session: Session): string[] {
    const keys = [this.indexKey('sub', session.subject)];
    const keycloakSessionId = session.primary.keycloakSessionId;
    if (keycloakSessionId) keys.push(this.indexKey('sid', keycloakSessionId));
    return keys;
  }

  private async indexSession(sid: string, session: Session): Promise<void> {
    const ttl = this.ttl(session);
    await this.redis.execute((client) =>
      Promise.all(
        this.sessionIndexKeys(session).map(async (index) => {
          await client.sadd(index, sid);
          await client.expire(index, ttl);
        }),
      ),
    );
  }

  private clientLockKey(sid: string, tool: string): string {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(tool)) throw new SessionError();
    return `${this.key(sid)}:client:${tool}:lock`;
  }

  private ttl(session: Session, now = Date.now()): number {
    const expiresAt = Math.min(
      session.absoluteExpiresAt,
      session.idleExpiresAt,
    );
    const ttl = Math.ceil((expiresAt - now) / 1000);
    if (ttl < 1 || ttl > this.config.sessionTtlSeconds)
      throw new SessionError();
    return ttl;
  }

  private validate(session: Session, now = Date.now()): void {
    if (
      !isSession(session) ||
      session.issuer !== this.config.issuer ||
      session.hubClientId !== this.config.hubClientId ||
      session.createdAt > now ||
      session.absoluteExpiresAt >
        session.createdAt + this.config.sessionTtlSeconds * 1000 ||
      session.absoluteExpiresAt <= now ||
      session.idleExpiresAt <= now ||
      session.primary.accessExpiresAt <= session.primary.issuedAt
    )
      throw new SessionError();
  }

  async create(session: Session): Promise<string> {
    this.validate(session);
    if (session.revision !== 1 || session.status !== 'active')
      throw new SessionError();
    for (let attempt = 0; attempt < 3; attempt++) {
      const sid = createSid();
      const result = await this.redis.execute((client) =>
        client.set(
          this.key(sid),
          JSON.stringify(session),
          'EX',
          this.ttl(session),
          'NX',
        ),
      );
      if (result === 'OK') {
        try {
          await this.indexSession(sid, session);
          return sid;
        } catch (error) {
          await this.redis
            .execute((client) => client.del(this.key(sid)))
            .catch(() => undefined);
          throw error;
        }
      }
    }
    throw new SessionError();
  }

  async get(sid: string): Promise<Session> {
    const raw = await this.redis.execute((client) => client.get(this.key(sid)));
    if (!raw) throw new SessionError();
    try {
      const session: unknown = JSON.parse(raw);
      if (!isSession(session)) throw new SessionError();
      this.validate(session);
      if (session.status !== 'active') throw new SessionError();
      return session;
    } catch {
      throw new SessionError();
    }
  }

  async replace(
    sid: string,
    expectedRevision: number,
    next: Session,
  ): Promise<boolean> {
    this.validate(next);
    if (next.status !== 'active' || next.revision !== expectedRevision + 1)
      throw new SessionError();
    const current = await this.get(sid);
    assertSameIdentity(current, next);
    const result = await this.redis.execute((client) =>
      client.eval(
        UPDATE_SCRIPT,
        1,
        this.key(sid),
        String(expectedRevision),
        JSON.stringify(next),
        String(this.ttl(next)),
      ),
    );
    if (result === 1) {
      await this.indexSession(sid, next);
      return true;
    }
    if (result === -1) return false;
    throw new SessionError();
  }

  async acquireRefreshLock(sid: string): Promise<string | undefined> {
    const owner = randomBytes(32).toString('base64url');
    const result = await this.redis.execute((client) =>
      client.set(this.lockKey(sid), owner, 'PX', REFRESH_LOCK_TTL_MS, 'NX'),
    );
    return result === 'OK' ? owner : undefined;
  }

  async releaseRefreshLock(sid: string, owner: string): Promise<void> {
    await this.redis.execute((client) =>
      client.eval(RELEASE_LOCK_SCRIPT, 1, this.lockKey(sid), owner),
    );
  }

  async acquireClientLock(
    sid: string,
    tool: string,
  ): Promise<string | undefined> {
    const owner = randomBytes(32).toString('base64url');
    const result = await this.redis.execute((client) =>
      client.set(
        this.clientLockKey(sid, tool),
        owner,
        'PX',
        REFRESH_LOCK_TTL_MS,
        'NX',
      ),
    );
    return result === 'OK' ? owner : undefined;
  }

  async releaseClientLock(
    sid: string,
    tool: string,
    owner: string,
  ): Promise<void> {
    await this.redis.execute((client) =>
      client.eval(RELEASE_LOCK_SCRIPT, 1, this.clientLockKey(sid, tool), owner),
    );
  }

  async replaceClientContext(
    sid: string,
    expectedRevision: number,
    tool: string,
    context: WebClientContext,
    lockOwner: string,
    now = Date.now(),
  ): Promise<ClientContextUpdateResult> {
    if (
      !isWebClientContext(context) ||
      context.tool !== tool ||
      !Number.isSafeInteger(now)
    ) {
      throw new SessionError();
    }
    const current = await this.get(sid);
    if (current.revision !== expectedRevision) return 'revision_mismatch';
    if (current.absoluteExpiresAt <= now || current.idleExpiresAt <= now)
      throw new SessionError();
    const next: Session = {
      ...current,
      revision: current.revision + 1,
      lastActivityAt: now,
      idleExpiresAt: Math.min(
        current.absoluteExpiresAt,
        now + this.config.sessionIdleTtlSeconds * 1000,
      ),
      clients: { ...current.clients, [tool]: context },
    };
    this.validate(next, now);
    const ttl = this.ttl(next, now);
    const result = await this.redis.execute((client) =>
      client.eval(
        UPDATE_CLIENT_CONTEXT_SCRIPT,
        2,
        this.key(sid),
        this.clientLockKey(sid, tool),
        String(expectedRevision),
        tool,
        JSON.stringify(context),
        String(now),
        JSON.stringify(next),
        String(ttl),
        lockOwner,
      ),
    );
    if (result === 1) {
      await this.indexSession(sid, await this.get(sid));
      return 'updated';
    }
    if (result === -1) return 'revision_mismatch';
    if (result === -5) return 'lock_lost';
    throw new SessionError();
  }

  async waitForRevision(
    sid: string,
    revision: number,
    timeoutMs = 2_000,
  ): Promise<Session> {
    const deadline = Date.now() + timeoutMs;
    do {
      const current = await this.get(sid);
      if (current.revision !== revision) return current;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    throw new SessionWaitTimeoutError();
  }

  async delete(sid: string): Promise<void> {
    const key = this.key(sid);
    const raw = await this.redis.execute((client) => client.get(key));
    let indexes: string[] = [];
    if (raw) {
      try {
        const session: unknown = JSON.parse(raw);
        if (isSession(session)) indexes = this.sessionIndexKeys(session);
      } catch {
        indexes = [];
      }
    }
    await this.redis.execute((client) => client.del(key));
    if (indexes.length) {
      await this.redis.execute((client) =>
        Promise.all(indexes.map((index) => client.srem(index, sid))),
      );
    }
  }

  async deleteByOidcSession(
    keycloakSessionId?: string,
    subject?: string,
  ): Promise<number> {
    const indexes = keycloakSessionId
      ? [this.indexKey('sid', keycloakSessionId)]
      : subject
        ? [this.indexKey('sub', subject)]
        : [];
    const sessionIds = new Set<string>();
    for (const index of indexes) {
      const values = await this.redis.execute((client) =>
        client.smembers(index),
      );
      for (const sid of values) sessionIds.add(sid);
    }
    for (const sid of sessionIds) await this.delete(sid);
    return sessionIds.size;
  }
}
