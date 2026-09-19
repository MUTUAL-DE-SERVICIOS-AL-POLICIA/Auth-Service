import { ArgumentsHost, Catch, RpcExceptionFilter } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';
import { WebAuthErrorCode, WebAuthPublicError } from './web-auth.errors';

const publicCodes = new Set<WebAuthErrorCode>([
  'WEB_AUTH_DISABLED',
  'INVALID_LOGIN_REQUEST',
  'LOGIN_STATE_INVALID',
  'OIDC_LOGIN_FAILED',
  'SESSION_INVALID',
  'AUTH_SERVICE_UNAVAILABLE',
]);

@Catch()
export class WebAuthRpcExceptionFilter implements RpcExceptionFilter<unknown> {
  catch(exception: unknown, _host: ArgumentsHost): Observable<never> {
    const code = this.getPublicCode(exception);
    const response = new WebAuthPublicError(code).toResponse();

    return throwError(() => response);
  }

  private getPublicCode(exception: unknown): WebAuthErrorCode {
    if (!(exception instanceof RpcException)) {
      return 'AUTH_SERVICE_UNAVAILABLE';
    }

    const payload = exception.getError();
    if (!this.isRecord(payload) || !this.isRecord(payload.error)) {
      return 'AUTH_SERVICE_UNAVAILABLE';
    }

    const code = payload.error.code;
    return typeof code === 'string' && publicCodes.has(code as WebAuthErrorCode)
      ? (code as WebAuthErrorCode)
      : 'AUTH_SERVICE_UNAVAILABLE';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
