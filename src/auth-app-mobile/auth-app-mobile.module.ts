import { Module } from '@nestjs/common';
import { AuthAppMobileService } from './auth-app-mobile.service';
import { AuthAppMobileController } from './auth-app-mobile.controller';

@Module({
  controllers: [AuthAppMobileController],
  providers: [AuthAppMobileService],
})
export class AuthAppMobileModule {}
