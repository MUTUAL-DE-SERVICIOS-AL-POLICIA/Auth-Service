import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { AuthAppMobileModule } from './auth-app-mobile/auth-app-mobile.module';

@Module({
  imports: [AuthModule, CommonModule, AuthAppMobileModule],
})
export class AppModule {}
