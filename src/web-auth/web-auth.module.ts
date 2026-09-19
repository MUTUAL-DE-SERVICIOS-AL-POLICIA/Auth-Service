import { DynamicModule, Module } from '@nestjs/common';
import { readWebAuthConfig, WebAuthConfig } from './web-auth.config';
import { KeycloakClient } from './oidc/keycloak-client';
import { WebRedisService } from './redis/web-redis.service';
import { PendingLoginStore } from './state/pending-login.store';
import { WebSessionStore } from './session/web-session.store';

@Module({})
export class WebAuthModule {
  static register(env: NodeJS.ProcessEnv = process.env): DynamicModule {
    const config = readWebAuthConfig(env);
    if (!config) return { module: WebAuthModule };
    return {
      module: WebAuthModule,
      providers: [
        { provide: WebAuthConfigToken, useValue: config },
        {
          provide: WebRedisService,
          useFactory: (cfg: WebAuthConfig) => new WebRedisService(cfg),
          inject: [WebAuthConfigToken],
        },
        {
          provide: KeycloakClient,
          useFactory: (cfg: WebAuthConfig) => new KeycloakClient(cfg),
          inject: [WebAuthConfigToken],
        },
        {
          provide: PendingLoginStore,
          useFactory: (redis: WebRedisService, cfg: WebAuthConfig) =>
            new PendingLoginStore(redis, cfg),
          inject: [WebRedisService, WebAuthConfigToken],
        },
        {
          provide: WebSessionStore,
          useFactory: (redis: WebRedisService, cfg: WebAuthConfig) =>
            new WebSessionStore(redis, cfg),
          inject: [WebRedisService, WebAuthConfigToken],
        },
      ],
      exports: [KeycloakClient, PendingLoginStore, WebSessionStore],
    };
  }
}

export const WebAuthConfigToken = Symbol('WebAuthConfig');
