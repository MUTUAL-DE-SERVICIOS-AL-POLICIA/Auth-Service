export interface StartWebLoginRequest {
  returnPath: string;
  browserBinding: string;
}

export interface StartWebLoginResponse {
  authorizationUrl: string;
}

export interface ExchangeWebCodeRequest {
  code: string;
  state: string;
  browserBinding: string;
}

export interface PresentationIdentity {
  sub: string;
  preferredUsername?: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
}

const identityKeys = new Set([
  'sub',
  'preferredUsername',
  'name',
  'givenName',
  'familyName',
  'email',
]);

export function isPresentationIdentity(
  value: unknown,
): value is PresentationIdentity {
  if (!value || typeof value !== 'object') return false;
  const identity = value as Record<string, unknown>;
  if (
    typeof identity.sub !== 'string' ||
    !identity.sub ||
    Object.keys(identity).some((key) => !identityKeys.has(key))
  )
    return false;
  return [...identityKeys]
    .filter((key) => key !== 'sub')
    .every(
      (key) => identity[key] === undefined || typeof identity[key] === 'string',
    );
}

export interface ExchangeWebCodeResponse {
  sid: string;
  returnPath: string;
  identity: PresentationIdentity;
  sessionExpiresAt: number;
  sessionAbsoluteExpiresAt: number;
}

export interface LogoutWebSessionRequest {
  sid: string;
}

export interface LogoutWebSessionResponse {
  logoutUrl: string;
}

export interface BackchannelLogoutRequest {
  logoutToken: string;
}

export interface CheckSessionRequest {
  sid: string;
}

export interface CheckSessionResponse {
  authenticated: true;
  identity: PresentationIdentity;
  sessionExpiresAt: number;
}

export interface EnsureWebClientContextRequest {
  sid: string;
  tool: string;
}

export type CheckWebClientRequest = EnsureWebClientContextRequest;

export interface CheckWebClientResponse {
  authenticated: true;
  currentTool: string;
  actor: WebAuthorizationActor;
}

export interface EnsureWebClientContextResponse {
  authenticated: true;
  currentTool: string;
  currentClient: string;
  identity: PresentationIdentity;
  realmRoles: string[];
  clientRoles: string[];
  groups: string[];
  contextExpiresAt: number;
  permissions: WebClientPermission[];
  permissionsExpiresAt: number;
  sessionExpiresAt: number;
  sessionAbsoluteExpiresAt: number;
}

export interface WebClientPermission {
  resource: string;
  scopes: string[];
}

export interface CheckWebAuthorizationRequest {
  sid: string;
  tool: string;
  resource: string;
  scope: string;
}

export interface WebAuthorizationActor {
  sub: string;
  preferredUsername?: string;
  name?: string;
}

export type CheckWebAuthorizationResponse =
  { authorized: true; actor: WebAuthorizationActor } | { authorized: false };

export const WebAuthPatterns = {
  loginStart: 'web-auth.login.start',
  loginExchange: 'web-auth.login.exchange',
  logout: 'web-auth.logout',
  sessionCheck: 'web-auth.session.check',
  clientCheck: 'web-auth.client.check',
  clientEnsure: 'web-auth.client.ensure',
  authorizationCheck: 'web-auth.authorization.check',
  backchannelLogout: 'web-auth.backchannel.logout',
} as const;
