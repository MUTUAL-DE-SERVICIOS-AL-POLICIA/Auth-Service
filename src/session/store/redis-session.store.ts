import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import {
  DEFAULT_SESSION_TTL_MS,
  SESSION_PREFIX,
} from '../session.constants';
import { SessionData } from '../session.types';
import { SessionStore } from './session.store';

@Injectable()
export class RedisSessionStore extends SessionStore {
  constructor(private readonly redisService: RedisService) {
    super();
  }

  async get(sid: string): Promise<SessionData | undefined> {
    const key = this.buildKey(sid);
    const raw = await this.redisService.getClient().get(key);

    if (!raw) return undefined;

    return JSON.parse(raw) as SessionData;
  }

  async set(
    sid: string,
    data: SessionData,
    ttlMs: number = DEFAULT_SESSION_TTL_MS,
  ): Promise<void> {
    const key = this.buildKey(sid);
    const value = JSON.stringify(data);

    await this.redisService.getClient().set(key, value, 'PX', ttlMs);
  }

  async del(sid: string): Promise<void> {
    const key = this.buildKey(sid);
    await this.redisService.getClient().del(key);
  }

  async touch(
    sid: string,
    ttlMs: number = DEFAULT_SESSION_TTL_MS,
  ): Promise<void> {
    const key = this.buildKey(sid);
    await this.redisService.getClient().pexpire(key, ttlMs);
  }

  async gc(): Promise<void> {
    // noop: Redis maneja expiración automática por TTL
  }

  private buildKey(sid: string): string {
    return `${SESSION_PREFIX}${sid}`;
  }
}