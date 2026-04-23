import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import {
  DEFAULT_PENDING_TTL_MS,
  PENDING_PREFIX,
} from '../session.constants';
import { PendingData } from '../session.types';
import { PendingStore } from './pending.store';

@Injectable()
export class RedisPendingStore extends PendingStore {
  constructor(private readonly redisService: RedisService) {
    super();
  }

  async set(
    state: string,
    data: PendingData,
    ttlMs: number = DEFAULT_PENDING_TTL_MS,
  ): Promise<void> {
    const key = this.buildKey(state);
    const value = JSON.stringify(data);

    await this.redisService.getClient().set(key, value, 'PX', ttlMs);
  }

  async take(state: string): Promise<PendingData | undefined> {
    const key = this.buildKey(state);
    const client = this.redisService.getClient();

    const raw = await client.eval(
      `
      local value = redis.call("GET", KEYS[1])
      if value then
        redis.call("DEL", KEYS[1])
      end
      return value
      `,
      1,
      key,
    );

    if (!raw) return undefined;

    return JSON.parse(String(raw)) as PendingData;
  }

  async gc(_ttlMs?: number): Promise<void> {
    // noop: Redis maneja expiración automática por TTL
  }

  private buildKey(state: string): string {
    return `${PENDING_PREFIX}${state}`;
  }
}