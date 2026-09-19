import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, RpcException } from '@nestjs/microservices';
import {
  CheckWebSessionRequest,
  ExchangeWebCodeRequest,
  StartWebLoginRequest,
  WebAuthPatterns,
} from './contracts/web-auth.contracts';
import { WebAuthPublicError } from './errors/web-auth.errors';
import { WebAuthService } from './web-auth.service';

@Controller()
export class WebAuthController {
  constructor(private readonly webAuth: WebAuthService) {}

  @MessagePattern(WebAuthPatterns.loginStart)
  start(@Payload() request: StartWebLoginRequest) {
    return this.publicResult(() => this.webAuth.start(request));
  }

  @MessagePattern(WebAuthPatterns.loginExchange)
  exchange(@Payload() request: ExchangeWebCodeRequest) {
    return this.publicResult(() => this.webAuth.exchange(request));
  }

  @MessagePattern(WebAuthPatterns.sessionCheck)
  check(@Payload() request: CheckWebSessionRequest) {
    return this.publicResult(() => this.webAuth.check(request));
  }

  private async publicResult<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const publicError =
        error instanceof WebAuthPublicError
          ? error
          : new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');
      throw new RpcException(publicError.toResponse());
    }
  }
}
