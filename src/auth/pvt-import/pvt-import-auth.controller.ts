import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { PvtImportAuthService } from './pvt-import-auth.service';

@Controller()
export class PvtImportAuthController {
  constructor(private readonly auth: PvtImportAuthService) {}

  @MessagePattern('auth.pvt-import.credentials.validate')
  validateCredentials(@Payload() data: { username: string; password: string }) {
    return this.auth.validateCredentials(data.username, data.password);
  }
}
