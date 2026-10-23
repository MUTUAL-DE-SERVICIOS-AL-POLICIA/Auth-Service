import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { LegacyAuthService } from './legacy-auth.service';

@Controller()
export class LegacyAuthController {
  constructor(private readonly auth: LegacyAuthService) {}

  @MessagePattern('auth.login')
  login(@Payload() data: { username: string; password: string }) {
    return this.auth.login(data.username, data.password);
  }

  @MessagePattern('auth.verify.token')
  verifyToken(@Payload() token: string) {
    return this.auth.verifyToken(token);
  }

  @MessagePattern('auth.verify.apiKey')
  verifyApiKey(@Payload() apiKey: string) {
    return this.auth.verifyApiKey(apiKey);
  }
}
