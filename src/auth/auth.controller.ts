import { Controller, Logger, UseGuards } from '@nestjs/common';
import { LdapAuthGuard } from './ldap-auth.guard';
import { AuthService } from './auth.service';
import { MessagePattern, Payload } from '@nestjs/microservices';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger('AuthController');
  constructor(private readonly authService: AuthService) {}

  @UseGuards(LdapAuthGuard)
  @MessagePattern('auth.login')
  async login(@Payload() data: any) {
    const cookieData = await this.authService.generateJwtWithUserDetails(
      data.user,
    );
    return cookieData;
  }

  @MessagePattern('auth.verify.token')
  async verifyToken(@Payload() token: string) {
    this.logger.debug('verify token');
    const user = await this.authService.verifyToken(token);
    return user;
  }

  @MessagePattern('auth.verify.apikey')
  async verifyApiKey(@Payload() apikey: string) {
    this.logger.debug('verify apikey');
    return await this.authService.verifyApiKey(apikey);
  }
}
