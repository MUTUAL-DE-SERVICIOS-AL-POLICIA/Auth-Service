import { ArgumentsHost, Catch, RpcExceptionFilter } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';
import { AuthErrorCode, AuthPublicError } from './auth.errors';

const publicCodes = new Set<AuthErrorCode>([
  'WEB_AUTH_DISABLED',
  'INVALID_LOGIN_REQUEST',
  'LOGIN_STATE_INVALID',
  'OIDC_LOGIN_FAILED',
  'SESSION_INVALID',
  'INVALID_CLIENT_REQUEST',
  'INVALID_AUTHORIZATION_REQUEST',
  'WEB_TOOL_UNAVAILABLE',
  'WEB_CLIENT_ACCESS_DENIED',
  'WEB_CLIENT_INVALID',
  'INVALID_LOGOUT_TOKEN',
  'AUTH_SERVICE_UNAVAILABLE',
]);

@Catch()
export class AuthRpcExceptionFilter implements RpcExceptionFilter<unknown> {
  catch(exception: unknown, _host: ArgumentsHost): Observable<never> {
    const code = this.getPublicCode(exception);
    const response = new AuthPublicError(code).toResponse();

    return throwError(() => response);
  }

  private getPublicCode(exception: unknown): AuthErrorCode {
    if (!(exception instanceof RpcException)) {
      return 'AUTH_SERVICE_UNAVAILABLE';
    }

    const payload = exception.getError();
    if (!this.isRecord(payload) || !this.isRecord(payload.error)) {
      return 'AUTH_SERVICE_UNAVAILABLE';
    }

    const code = payload.error.code;
    return typeof code === 'string' && publicCodes.has(code as AuthErrorCode)
      ? (code as AuthErrorCode)
      : 'AUTH_SERVICE_UNAVAILABLE';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
