import { Controller, Logger } from '@nestjs/common';
import { LegacyAuthService } from './legacy-auth.service';
import { MessagePattern, Payload } from '@nestjs/microservices';

@Controller('auth')
export class LegacyAuthController {
  private readonly logger = new Logger('LegacyAuthController');
  constructor(private readonly authService: LegacyAuthService) {}

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
