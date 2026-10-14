import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { createWebAuthConfig, WebAuthConfig } from './config/auth.config';
import { KeycloakClient } from './oidc/keycloak-client';
import { RedisService } from '../common/services/redis.service';
import { PendingLoginStore } from './state/pending-login.store';
import { SessionStore } from './session/session.store';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { WebAuthConfigToken } from './config/auth.tokens';
import type { WebAuthEnv } from '../config/envs';
import { LegacyAuthController } from './legacy/legacy-auth.controller';
import { LegacyAuthService } from './legacy/legacy-auth.service';
import { LegacyAuthEnvs } from '../config/envs';

@Module({})
export class AuthModule {
  static register(env: WebAuthEnv): DynamicModule {
    const config = createWebAuthConfig(env);
    const common = [
      { provide: WebAuthConfigToken, useValue: config },
      AuthService,
      LegacyAuthService,
    ];
    const imports = [
      JwtModule.register({
        secret: LegacyAuthEnvs.jwtSecret,
        signOptions: { expiresIn: '4h' },
      }),
    ];
    if (!config)
      return {
        module: AuthModule,
        controllers: [AuthController, LegacyAuthController],
        imports,
        providers: common,
      };
    return {
      module: AuthModule,
      controllers: [AuthController, LegacyAuthController],
      imports,
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
