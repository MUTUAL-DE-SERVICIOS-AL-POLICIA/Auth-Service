import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

export interface RedisConfig {
  host: string;
  port: number;
  password: string;
}

export class StoreUnavailableError extends Error {
  constructor() {
    super('Authentication store unavailable');
  }
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client?: Redis;
  private connecting?: Promise<Redis>;

  constructor(private readonly config: RedisConfig) {}

  async execute<T>(operation: (client: Redis) => Promise<T>): Promise<T> {
    try {
      const client = await this.readyClient();
      return await operation(client);
    } catch {
      throw new StoreUnavailableError();
    }
  }

  private async readyClient(): Promise<Redis> {
    if (!this.client) {
      this.client = new Redis({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
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
