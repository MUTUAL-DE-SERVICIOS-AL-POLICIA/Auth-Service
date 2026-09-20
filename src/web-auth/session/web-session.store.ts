import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createSid } from '../crypto';
import { WebRedisService } from '../redis/web-redis.service';
import { WebAuthConfig } from '../web-auth.config';
import {
  assertSameIdentity,
  isWebClientContext,
  isWebSession,
  WebClientContext,
  WebSession,
} from './web-session';

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
if redis.call('GET', KEYS[2]) ~= ARGV[6] then return -5 end
local ok, current = pcall(cjson.decode, raw)
if not ok or current.schemaVersion ~= 2 then return -2 end
if current.status ~= 'active' then return -3 end
if current.revision ~= tonumber(ARGV[1]) then return -1 end
local contextOk, context = pcall(cjson.decode, ARGV[3])
if not contextOk or context.tool ~= ARGV[2] then return -2 end
if context.subject ~= current.subject or context.issuer ~= current.issuer then return -2 end
local now = tonumber(ARGV[4])
if current.absoluteExpiresAt <= now or current.idleExpiresAt <= now then return -4 end
local idleExpiresAt = math.min(current.absoluteExpiresAt, now + tonumber(ARGV[5]))
local ttl = math.ceil((math.min(current.absoluteExpiresAt, idleExpiresAt) - now) / 1000)
if ttl < 1 then return -4 end
if type(current.clients) ~= 'table' then return -2 end
current.clients[ARGV[2]] = context
current.revision = current.revision + 1
current.lastActivityAt = now
current.idleExpiresAt = idleExpiresAt
redis.call('SET', KEYS[1], cjson.encode(current), 'EX', ttl)
return 1
`;

export class WebSessionError extends Error {
  constructor() {
    super('Web session unavailable or invalid');
  }
}

export type ClientContextUpdateResult =
  'updated' | 'revision_mismatch' | 'lock_lost';

@Injectable()
export class WebSessionStore {
  constructor(
    private readonly redis: WebRedisService,
    private readonly config: WebAuthConfig,
  ) {}

  private key(sid: string): string {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(sid)) throw new WebSessionError();
    return `${this.config.redisKeyPrefix}:${this.config.environment}:session:${sid}`;
  }

  private lockKey(sid: string): string {
    return `${this.key(sid)}:refresh-lock`;
  }

  private clientLockKey(sid: string, tool: string): string {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(tool)) throw new WebSessionError();
    return `${this.key(sid)}:client:${tool}:lock`;
  }

  private ttl(session: WebSession, now = Date.now()): number {
    const expiresAt = Math.min(
      session.absoluteExpiresAt,
      session.idleExpiresAt,
    );
    const ttl = Math.ceil((expiresAt - now) / 1000);
    if (ttl < 1 || ttl > this.config.sessionTtlSeconds)
      throw new WebSessionError();
    return ttl;
  }

  private validate(session: WebSession, now = Date.now()): void {
    if (
      !isWebSession(session) ||
      session.issuer !== this.config.issuer ||
      session.hubClientId !== this.config.hubClientId ||
      session.createdAt > now ||
      session.absoluteExpiresAt >
        session.createdAt + this.config.sessionTtlSeconds * 1000 ||
      session.absoluteExpiresAt <= now ||
      session.idleExpiresAt <= now ||
      session.primary.accessExpiresAt <= session.primary.issuedAt
    )
      throw new WebSessionError();
  }

  async create(session: WebSession): Promise<string> {
    this.validate(session);
    if (session.revision !== 1 || session.status !== 'active')
      throw new WebSessionError();
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
      if (result === 'OK') return sid;
    }
    throw new WebSessionError();
  }

  async get(sid: string): Promise<WebSession> {
    const raw = await this.redis.execute((client) => client.get(this.key(sid)));
    if (!raw) throw new WebSessionError();
    try {
      const session: unknown = JSON.parse(raw);
      if (!isWebSession(session)) throw new WebSessionError();
      this.validate(session);
      if (session.status !== 'active') throw new WebSessionError();
      return session;
    } catch {
      throw new WebSessionError();
    }
  }

  async replace(
    sid: string,
    expectedRevision: number,
    next: WebSession,
  ): Promise<boolean> {
    this.validate(next);
    if (next.status !== 'active' || next.revision !== expectedRevision + 1)
      throw new WebSessionError();
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
    if (result === 1) return true;
    if (result === -1) return false;
    throw new WebSessionError();
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
      throw new WebSessionError();
    }
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
        String(this.config.sessionIdleTtlSeconds * 1000),
        lockOwner,
      ),
    );
    if (result === 1) return 'updated';
    if (result === -1) return 'revision_mismatch';
    if (result === -5) return 'lock_lost';
    throw new WebSessionError();
  }

  async waitForRevision(
    sid: string,
    revision: number,
    timeoutMs = 2_000,
  ): Promise<WebSession> {
    const deadline = Date.now() + timeoutMs;
    do {
      const current = await this.get(sid);
      if (current.revision !== revision) return current;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    throw new WebSessionError();
  }

  async delete(sid: string): Promise<void> {
    await this.redis.execute((client) => client.del(this.key(sid)));
  }
}
