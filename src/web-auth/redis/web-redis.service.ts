import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { WebAuthConfig } from '../web-auth.config';

export class WebStoreUnavailableError extends Error {
  constructor() {
    super('Web session store unavailable');
  }
}

@Injectable()
export class WebRedisService implements OnModuleDestroy {
  private client?: Redis;
  private connecting?: Promise<Redis>;

  constructor(private readonly config: WebAuthConfig) {}

  async execute<T>(operation: (client: Redis) => Promise<T>): Promise<T> {
    try {
      const client = await this.readyClient();
      return await operation(client);
    } catch {
      throw new WebStoreUnavailableError();
    }
  }

  private async readyClient(): Promise<Redis> {
    if (!this.client) {
      this.client = new Redis({
        host: this.config.redisHost,
        port: this.config.redisPort,
        password: this.config.redisPassword,
        lazyConnect: true,
        enableOfflineQueue: false,
        connectTimeout: 1500,
        commandTimeout: 2000,
        maxRetriesPerRequest: 1,
        retryStrategy: (attempt) => (attempt <= 2 ? attempt * 250 : null),
      });
      // Prevent a rejected connection from becoming an unhandled error.
      this.client.on('error', () => undefined);
    }
    if (this.client.status === 'ready') return this.client;
    if (!this.connecting) {
      this.connecting = this.client
        .connect()
        .then(() => this.client!)
        .finally(() => {
          this.connecting = undefined;
        });
    }
    return this.connecting;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    if (this.client.status === 'ready') {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    } else {
      this.client.disconnect();
    }
  }
}
