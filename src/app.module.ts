import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { AuthAppMobileModule } from './auth-app-mobile/auth-app-mobile.module';
import { KeycloakModule } from './keycloak/keycloak.module';
import { RedisModule } from './redis/redis.module';
import { SessionModule } from './session/session.module';

@Module({
  imports: [
    RedisModule,
    AuthModule,
    CommonModule,
    AuthAppMobileModule,
    KeycloakModule,
    SessionModule,
  ],
})
export class AppModule {}
