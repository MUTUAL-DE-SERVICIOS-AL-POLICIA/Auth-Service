import { DynamicModule, Module } from '@nestjs/common';
import { readAuthConfig, AuthConfig } from './config/auth.config';
import { KeycloakClient } from './oidc/keycloak-client';
import { RedisService } from '../common/services/redis.service';
import { PendingLoginStore } from './state/pending-login.store';
import { SessionStore } from './session/session.store';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthConfigToken } from './auth.tokens';

@Module({})
export class AuthModule {
  static register(env: NodeJS.ProcessEnv = process.env): DynamicModule {
    const config = readAuthConfig(env);
    const common = [
      { provide: AuthConfigToken, useValue: config },
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
          useFactory: (cfg: AuthConfig) =>
            new RedisService({
              host: cfg.redisHost,
              port: cfg.redisPort,
              password: cfg.redisPassword,
            }),
          inject: [AuthConfigToken],
        },
        {
          provide: KeycloakClient,
          useFactory: (cfg: AuthConfig) => new KeycloakClient(cfg),
          inject: [AuthConfigToken],
        },
        {
          provide: PendingLoginStore,
          useFactory: (redis: RedisService, cfg: AuthConfig) =>
            new PendingLoginStore(redis, cfg),
          inject: [RedisService, AuthConfigToken],
        },
        {
          provide: SessionStore,
          useFactory: (redis: RedisService, cfg: AuthConfig) =>
            new SessionStore(redis, cfg),
          inject: [RedisService, AuthConfigToken],
        },
      ],
      exports: [KeycloakClient, PendingLoginStore, SessionStore, AuthService],
    };
  }
}
