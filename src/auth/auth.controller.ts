import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload, RpcException } from '@nestjs/microservices';
import {
  BackchannelLogoutRequest,
  CheckSessionRequest,
  CheckWebClientRequest,
  CheckWebAuthorizationRequest,
  EnsureWebClientContextRequest,
  ExchangeWebCodeRequest,
  LogoutWebSessionRequest,
  StartWebLoginRequest,
  WebAuthPatterns,
} from './contracts/auth.contracts';
import { AuthPublicError } from './errors/auth.errors';
import { AuthRpcExceptionFilter } from './errors/auth-rpc-exception.filter';
import { AuthService } from './auth.service';

@Controller()
@UseFilters(new AuthRpcExceptionFilter())
export class AuthController {
  constructor(private readonly webAuth: AuthService) {}

  @MessagePattern(WebAuthPatterns.loginStart)
  start(@Payload() request: StartWebLoginRequest) {
    return this.publicResult(() => this.webAuth.start(request));
  }

  @MessagePattern(WebAuthPatterns.loginExchange)
  exchange(@Payload() request: ExchangeWebCodeRequest) {
    return this.publicResult(() => this.webAuth.exchange(request));
  }

  @MessagePattern(WebAuthPatterns.logout)
  logout(@Payload() request: LogoutWebSessionRequest) {
    return this.publicResult(() => this.webAuth.logout(request));
  }

  @MessagePattern(WebAuthPatterns.sessionCheck)
  check(@Payload() request: CheckSessionRequest) {
    return this.publicResult(() => this.webAuth.check(request));
  }

  @MessagePattern(WebAuthPatterns.backchannelLogout)
  backchannelLogout(@Payload() request: BackchannelLogoutRequest) {
    return this.publicResult(() =>
      this.webAuth.backchannelLogout(request.logoutToken),
    );
  }

  @MessagePattern(WebAuthPatterns.clientEnsure)
  ensureClient(@Payload() request: EnsureWebClientContextRequest) {
    return this.publicResult(() => this.webAuth.getWebClientContext(request));
  }

  @MessagePattern(WebAuthPatterns.clientCheck)
  checkClient(@Payload() request: CheckWebClientRequest) {
    return this.publicResult(() => this.webAuth.checkWebClient(request));
  }

  @MessagePattern(WebAuthPatterns.authorizationCheck)
  authorize(@Payload() request: CheckWebAuthorizationRequest) {
    return this.publicResult(() => this.webAuth.checkAuthorization(request));
  }

  private async publicResult<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const publicError =
        error instanceof AuthPublicError
          ? error
          : new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
      throw new RpcException(publicError.toResponse());
    }
  }
}
