import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisEnvs } from 'src/config';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor() {
    this.client = new Redis({
      host: RedisEnvs.host,
      port: Number(RedisEnvs.port),
      password: RedisEnvs.password || undefined,
      db: 0,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
  }

  async onModuleInit() {
    this.client.on('connect', () => {
      this.logger.log('Conectando a Redis...');
    });

    this.client.on('ready', () => {
      this.logger.log('Redis listo');
    });

    this.client.on('error', (error) => {
      this.logger.error(`Error en Redis: ${error.message}`, error.stack);
    });

    this.client.on('close', () => {
      this.logger.warn('Conexión Redis cerrada');
    });

    await this.client.ping();
    this.logger.log('Ping a Redis exitoso');
  }

  async onModuleDestroy() {
    await this.client.quit();
    this.logger.log('Conexión Redis cerrada correctamente');
  }

  getClient(): Redis {
    return this.client;
  }
}