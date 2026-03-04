import { Controller, Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { MessagePattern, Payload } from '@nestjs/microservices';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger('AuthController');
  constructor(private readonly authService: AuthService) {}

  @MessagePattern('auth.login')
  async login(@Payload() data: any) {
    return this.authService.login(data.username, data.password);
  }

  @MessagePattern('auth.verify.token')
  async verifyToken(@Payload() token: string) {
    return this.authService.verifyToken(token);
  }

  @MessagePattern('auth.verify.apiKey')
  async verifyApiKey(@Payload() apiKey: string) {
    return this.authService.verifyApiKey(apiKey);
  }
}
