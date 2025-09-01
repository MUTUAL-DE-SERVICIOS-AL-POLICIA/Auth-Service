import { Controller, Logger } from '@nestjs/common';
import { AuthAppMobileService } from './auth-app-mobile.service';
import { MessagePattern, Payload } from '@nestjs/microservices';

@Controller('authAppMobile')
export class AuthAppMobileController {
  private readonly logger = new Logger('AuthController');
  constructor(private readonly authAppMobileService: AuthAppMobileService) {}

  @MessagePattern('auth.loginAppMobile')
  async loginAppMobile(@Payload() body: any) {
    return await this.authAppMobileService.loginAppMobile(body);
  }

  @MessagePattern('auth.verifyPin')
  async verifyPin(@Payload() body: any) {
    return await this.authAppMobileService.verifyPin(body);
  }

  @MessagePattern('auth.verifyApiTokenAppMobile')
  async version(@Payload() body: any) {
    return await this.authAppMobileService.verifyApiTokenAppMobile(body);
  }

  @MessagePattern('auth.logoutAppMobile')
  async logoutAppMobile(@Payload() body: any) {
    return await this.authAppMobileService.logoutAppMobile(body);
  }
}
