import { OidcError } from '../oidc/keycloak-client';
import { StoreUnavailableError } from '../../common/services/redis.service';
import { SessionError } from '../session/session.store';
import { PendingLoginError } from '../state/pending-login.store';

export type AuthErrorCode =
  | 'WEB_AUTH_DISABLED'
  | 'INVALID_LOGIN_REQUEST'
  | 'LOGIN_STATE_INVALID'
  | 'OIDC_LOGIN_FAILED'
  | 'SESSION_INVALID'
  | 'INVALID_CLIENT_REQUEST'
  | 'INVALID_AUTHORIZATION_REQUEST'
  | 'WEB_TOOL_UNAVAILABLE'
  | 'WEB_CLIENT_ACCESS_DENIED'
  | 'WEB_CLIENT_INVALID'
  | 'INVALID_LOGOUT_TOKEN'
  | 'AUTH_SERVICE_UNAVAILABLE';

const messages: Record<AuthErrorCode, string> = {
  WEB_AUTH_DISABLED: 'Web authentication is disabled',
  INVALID_LOGIN_REQUEST: 'Invalid login request',
  LOGIN_STATE_INVALID: 'Login state is invalid or expired',
  OIDC_LOGIN_FAILED: 'OIDC login failed',
  SESSION_INVALID: 'Session is invalid or expired',
  INVALID_CLIENT_REQUEST: 'Invalid web client request',
  INVALID_AUTHORIZATION_REQUEST: 'Invalid web authorization request',
  WEB_TOOL_UNAVAILABLE: 'Web tool is unavailable',
  WEB_CLIENT_ACCESS_DENIED: 'Web client access was denied',
  WEB_CLIENT_INVALID: 'Web client response is invalid',
  INVALID_LOGOUT_TOKEN: 'Invalid back-channel logout token',
  AUTH_SERVICE_UNAVAILABLE: 'Authentication service is unavailable',
};

export class AuthPublicError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(messages[code]);
  }

  toResponse(): { error: { code: AuthErrorCode; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}

export function asStartError(error: unknown): AuthPublicError {
  if (error instanceof AuthPublicError) return error;
  if (
    error instanceof StoreUnavailableError ||
    error instanceof PendingLoginError
  )
    return new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
  if (error instanceof OidcError)
    return new AuthPublicError('OIDC_LOGIN_FAILED');
  return new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
}

export function asExchangeError(error: unknown): AuthPublicError {
  if (error instanceof AuthPublicError) return error;
  if (error instanceof StoreUnavailableError)
    return new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
  if (error instanceof PendingLoginError)
    return new AuthPublicError('LOGIN_STATE_INVALID');
  if (error instanceof OidcError)
    return new AuthPublicError('OIDC_LOGIN_FAILED');
  if (error instanceof SessionError)
    return new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
  return new AuthPublicError('OIDC_LOGIN_FAILED');
}

export function asSessionError(error: unknown): AuthPublicError {
  if (error instanceof AuthPublicError) return error;
  if (error instanceof StoreUnavailableError)
    return new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
  return new AuthPublicError('SESSION_INVALID');
}

export function asClientEnsureError(error: unknown): AuthPublicError {
  if (error instanceof AuthPublicError) return error;
  if (error instanceof StoreUnavailableError)
    return new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
  if (error instanceof SessionError)
    return new AuthPublicError('SESSION_INVALID');
  if (error instanceof OidcError) {
    if (error.kind === 'access_denied')
      return new AuthPublicError('WEB_CLIENT_ACCESS_DENIED');
    if (
      error.kind === 'invalid_target' ||
      error.kind === 'unauthorized_client' ||
      error.kind === 'invalid_configuration'
    )
      return new AuthPublicError('WEB_TOOL_UNAVAILABLE');
    if (error.kind === 'invalid_response' || error.kind === 'invalid_token')
      return new AuthPublicError('WEB_CLIENT_INVALID');
  }
  return new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
}

export function asAuthorizationError(error: unknown): AuthPublicError {
  if (error instanceof AuthPublicError) return error;
  if (error instanceof SessionError)
    return new AuthPublicError('SESSION_INVALID');
  return new AuthPublicError('AUTH_SERVICE_UNAVAILABLE');
}
