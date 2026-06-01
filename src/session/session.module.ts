import { Module } from '@nestjs/common';
import { RedisModule } from 'src/redis/redis.module';

import { PendingStore } from './pending/pending.store';
import { RedisPendingStore } from './pending/redis-pending.store';

import { SessionStore } from './store/session.store';
import { RedisSessionStore } from './store/redis-session.store';

@Module({
  imports: [RedisModule],
  providers: [
    RedisPendingStore,
    RedisSessionStore,
    {
      provide: PendingStore,
      useExisting: RedisPendingStore,
    },
    {
      provide: SessionStore,
      useExisting: RedisSessionStore,
    },
  ],
  exports: [PendingStore, SessionStore],
})
export class SessionModule {}