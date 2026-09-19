import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { AuthAppMobileModule } from './auth-app-mobile/auth-app-mobile.module';
import { AuthBcbModule } from './auth-bcb/auth-bcb.module';
import { DatabaseModule } from './database/database.module';
import { WebAuthModule } from './web-auth/web-auth.module';


@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }),DatabaseModule , AuthModule, CommonModule, AuthAppMobileModule, AuthBcbModule, WebAuthModule.register()],
})
export class AppModule {}
