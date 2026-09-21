import { Controller } from '@nestjs/common';
import { AuthBcbService } from './auth-bcb.service';
import { MessagePattern, Payload } from '@nestjs/microservices';

@Controller()
export class AuthBcbController {
  constructor(private readonly authBcbService: AuthBcbService) {}

  @MessagePattern('authBcb.generateJwt')
  async generateBcbJwt() {
    const jwt = await this.authBcbService.generateBcbJwt();
    return {
      access_token: jwt,
    };
  }

  @MessagePattern('authBcb.verifyJwt')
  async verifyBcbJwt(@Payload() token: string) {
    const decoded = await this.authBcbService.verifyBcbJwt(token);
    return decoded;
  }
}
