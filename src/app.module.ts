import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { AuthAppMobileModule } from './auth-app-mobile/auth-app-mobile.module';
import { DatabaseModule } from './database/database.module';


@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }),DatabaseModule , AuthModule, CommonModule, AuthAppMobileModule],
})
export class AppModule {}
