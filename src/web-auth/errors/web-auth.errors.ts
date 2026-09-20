import { OidcError } from '../oidc/keycloak-client';
import { WebStoreUnavailableError } from '../redis/web-redis.service';
import { WebSessionError } from '../session/web-session.store';
import { PendingLoginError } from '../state/pending-login.store';

export type WebAuthErrorCode =
  | 'WEB_AUTH_DISABLED'
  | 'INVALID_LOGIN_REQUEST'
  | 'LOGIN_STATE_INVALID'
  | 'OIDC_LOGIN_FAILED'
  | 'SESSION_INVALID'
  | 'INVALID_CLIENT_REQUEST'
  | 'WEB_TOOL_UNAVAILABLE'
  | 'WEB_CLIENT_ACCESS_DENIED'
  | 'WEB_CLIENT_INVALID'
  | 'AUTH_SERVICE_UNAVAILABLE';

const messages: Record<WebAuthErrorCode, string> = {
  WEB_AUTH_DISABLED: 'Web authentication is disabled',
  INVALID_LOGIN_REQUEST: 'Invalid login request',
  LOGIN_STATE_INVALID: 'Login state is invalid or expired',
  OIDC_LOGIN_FAILED: 'OIDC login failed',
  SESSION_INVALID: 'Session is invalid or expired',
  INVALID_CLIENT_REQUEST: 'Invalid web client request',
  WEB_TOOL_UNAVAILABLE: 'Web tool is unavailable',
  WEB_CLIENT_ACCESS_DENIED: 'Web client access was denied',
  WEB_CLIENT_INVALID: 'Web client response is invalid',
  AUTH_SERVICE_UNAVAILABLE: 'Authentication service is unavailable',
};

export class WebAuthPublicError extends Error {
  constructor(readonly code: WebAuthErrorCode) {
    super(messages[code]);
  }

  toResponse(): { error: { code: WebAuthErrorCode; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}

export function asStartError(error: unknown): WebAuthPublicError {
  if (error instanceof WebAuthPublicError) return error;
  if (
    error instanceof WebStoreUnavailableError ||
    error instanceof PendingLoginError
  )
    return new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');
  if (error instanceof OidcError)
    return new WebAuthPublicError('OIDC_LOGIN_FAILED');
  return new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');
}

export function asExchangeError(error: unknown): WebAuthPublicError {
  if (error instanceof WebAuthPublicError) return error;
  if (error instanceof WebStoreUnavailableError)
    return new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');
  if (error instanceof PendingLoginError)
    return new WebAuthPublicError('LOGIN_STATE_INVALID');
  if (error instanceof OidcError)
    return new WebAuthPublicError('OIDC_LOGIN_FAILED');
  if (error instanceof WebSessionError)
    return new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');
  return new WebAuthPublicError('OIDC_LOGIN_FAILED');
}

export function asSessionError(error: unknown): WebAuthPublicError {
  if (error instanceof WebAuthPublicError) return error;
  if (error instanceof WebStoreUnavailableError)
    return new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');
  return new WebAuthPublicError('SESSION_INVALID');
}

export function asClientEnsureError(error: unknown): WebAuthPublicError {
  if (error instanceof WebAuthPublicError) return error;
  if (error instanceof WebStoreUnavailableError)
    return new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');
  if (error instanceof WebSessionError)
    return new WebAuthPublicError('SESSION_INVALID');
  if (error instanceof OidcError) {
    if (error.kind === 'access_denied')
      return new WebAuthPublicError('WEB_CLIENT_ACCESS_DENIED');
    if (
      error.kind === 'invalid_target' ||
      error.kind === 'unauthorized_client' ||
      error.kind === 'invalid_configuration'
    )
      return new WebAuthPublicError('WEB_TOOL_UNAVAILABLE');
    if (error.kind === 'invalid_response' || error.kind === 'invalid_token')
      return new WebAuthPublicError('WEB_CLIENT_INVALID');
  }
  return new WebAuthPublicError('AUTH_SERVICE_UNAVAILABLE');
}
