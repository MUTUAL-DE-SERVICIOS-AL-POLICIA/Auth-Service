import { Controller, Logger, UseGuards } from '@nestjs/common';
import { LdapAuthGuard } from './ldap-auth.guard';
import { AuthService } from './auth.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PvtbeEnvs } from 'src/config';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger('AuthController');
  constructor(private readonly authService: AuthService) {}

  @UseGuards(LdapAuthGuard)
  @MessagePattern('auth.login')
  async login(@Payload() data: any) {
    if (
      data.username == PvtbeEnvs.pvtbeUsername &&
      data.password == PvtbeEnvs.pvtbePassword
    ) {
      const user = {
        uid: 'pvtbe',
      };
      const jwt = await this.authService.generateJwt(user, false);
      return {
        access_token: jwt,
        user: {
          username: 'pvtbe',
          name: 'pvtbe',
        },
      };
    }
    const jwt = await this.authService.generateJwt(data.user, data.longToken);
    return {
      access_token: jwt,
      user: {
        username: data.user.uid,
        name: data.user.cn,
      },
    };
  }

  @MessagePattern('auth.verify')
  async verify(@Payload() token: string) {
    this.logger.debug('verify');
    const username = await this.authService.verifyToken(token);
    return {
      username,
    };
  }
}
