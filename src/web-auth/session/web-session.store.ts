import { Injectable } from '@nestjs/common';
import { createSid } from '../crypto';
import { WebRedisService } from '../redis/web-redis.service';
import { WebAuthConfig } from '../web-auth.config';
import { isWebSession, WebSession } from './web-session';

export class WebSessionError extends Error {
  constructor() {
    super('Web session unavailable or invalid');
  }
}

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

  async create(session: WebSession): Promise<string> {
    if (
      !isWebSession(session) ||
      session.version !== 1 ||
      session.issuer !== this.config.issuer ||
      session.hubClientId !== this.config.hubClientId ||
      session.createdAt > Date.now() ||
      session.hubTokens.expiresAt <= Date.now() ||
      session.expiresAt >
        session.createdAt + this.config.sessionTtlSeconds * 1000 ||
      session.expiresAt <= Date.now()
    )
      throw new WebSessionError();
    for (let attempt = 0; attempt < 3; attempt++) {
      const sid = createSid();
      const ttl = Math.min(
        this.config.sessionTtlSeconds,
        Math.ceil((session.expiresAt - Date.now()) / 1000),
      );
      if (ttl < 1) throw new WebSessionError();
      const result = await this.redis.execute((client) =>
        client.set(this.key(sid), JSON.stringify(session), 'EX', ttl, 'NX'),
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
      if (
        !isWebSession(session) ||
        session.expiresAt <= Date.now() ||
        session.issuer !== this.config.issuer ||
        session.hubClientId !== this.config.hubClientId
      )
        throw new WebSessionError();
      return session;
    } catch {
      throw new WebSessionError();
    }
  }

  async delete(sid: string): Promise<void> {
    await this.redis.execute((client) => client.del(this.key(sid)));
  }
}
