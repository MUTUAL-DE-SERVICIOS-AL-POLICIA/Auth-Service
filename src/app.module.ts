import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { AuthAppMobileModule } from './auth-app-mobile/auth-app-mobile.module';
import { AuthBcbModule } from './auth-bcb/auth-bcb.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    AuthAppMobileModule,
    AuthBcbModule,
    AuthModule.register(),
  ],
})
export class AppModule {}
