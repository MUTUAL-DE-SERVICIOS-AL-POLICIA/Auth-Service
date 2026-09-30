import { DynamicModule, Module } from '@nestjs/common';
import { createWebAuthConfig, WebAuthConfig } from './config/auth.config';
import { KeycloakClient } from './oidc/keycloak-client';
import { RedisService } from '../common/services/redis.service';
import { PendingLoginStore } from './state/pending-login.store';
import { SessionStore } from './session/session.store';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { WebAuthConfigToken } from './config/auth.tokens';
import type { WebAuthEnv } from '../config/envs';

@Module({})
export class AuthModule {
  static register(env: WebAuthEnv): DynamicModule {
    const config = createWebAuthConfig(env);
    const common = [
      { provide: WebAuthConfigToken, useValue: config },
      AuthService,
    ];
    if (!config)
      return {
        module: AuthModule,
        controllers: [AuthController],
        providers: common,
      };
    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        ...common,
        {
          provide: RedisService,
          useFactory: (cfg: WebAuthConfig) =>
            new RedisService({
              host: cfg.redisHost,
              port: cfg.redisPort,
              password: cfg.redisPassword,
            }),
          inject: [WebAuthConfigToken],
        },
        {
          provide: KeycloakClient,
          useFactory: (cfg: WebAuthConfig) => new KeycloakClient(cfg),
          inject: [WebAuthConfigToken],
        },
        {
          provide: PendingLoginStore,
          useFactory: (redis: RedisService, cfg: WebAuthConfig) =>
            new PendingLoginStore(redis, cfg),
          inject: [RedisService, WebAuthConfigToken],
        },
        {
          provide: SessionStore,
          useFactory: (redis: RedisService, cfg: WebAuthConfig) =>
            new SessionStore(redis, cfg),
          inject: [RedisService, WebAuthConfigToken],
        },
      ],
      exports: [KeycloakClient, PendingLoginStore, SessionStore, AuthService],
    };
  }
}
