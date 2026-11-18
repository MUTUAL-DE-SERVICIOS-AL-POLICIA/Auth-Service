import {
  isPresentationIdentity,
  PresentationIdentity,
} from '../contracts/auth.contracts';

export interface Session {
  schemaVersion: 2;
  revision: number;
  status: 'active' | 'closing';
  subject: string;
  issuer: string;
  hubClientId: string;
  createdAt: number;
  absoluteExpiresAt: number;
  idleExpiresAt: number;
  lastActivityAt: number;
  identity: PresentationIdentity;
  primary: WebTokenSet;
  clients: Record<string, WebClientContext>;
}

export interface WebTokenSet {
  tokenType: string;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  idExpiresAt?: number;
  issuedAt: number;
  accessExpiresAt: number;
  refreshExpiresAt?: number;
  keycloakSessionId?: string;
}

export interface WebClientContext {
  tool: string;
  clientId: string;
  audience: string;
  resourceServer: string;
  source: 'token-exchange';
  tokens: WebClientTokenSet;
  subject: string;
  issuer: string;
  azp?: string;
  keycloakSessionId?: string;
  realmRoles: string[];
  clientRoles: string[];
  groups: string[];
}

export interface WebClientTokenSet {
  tokenType: 'Bearer';
  accessToken: string;
  accessExpiresAt: number;
  refreshToken?: string;
  refreshExpiresIn?: number;
  idToken?: string;
  issuedTokenType?: string;
  scope?: string;
  issuedAt: number;
}

function isTokenSet(value: unknown): value is WebTokenSet {
  if (!value || typeof value !== 'object') return false;
  const token = value as Record<string, unknown>;
  return (
    typeof token.tokenType === 'string' &&
    !!token.tokenType &&
    typeof token.accessToken === 'string' &&
    !!token.accessToken &&
    (token.refreshToken === undefined ||
      (typeof token.refreshToken === 'string' && !!token.refreshToken)) &&
    (token.idToken === undefined ||
      (typeof token.idToken === 'string' && !!token.idToken)) &&
    (token.idExpiresAt === undefined || Number.isFinite(token.idExpiresAt)) &&
    ((token.idToken === undefined && token.idExpiresAt === undefined) ||
      (token.idToken !== undefined && token.idExpiresAt !== undefined)) &&
    Number.isFinite(token.issuedAt) &&
    Number.isFinite(token.accessExpiresAt) &&
    (token.refreshExpiresAt === undefined ||
      Number.isFinite(token.refreshExpiresAt)) &&
    (token.keycloakSessionId === undefined ||
      (typeof token.keycloakSessionId === 'string' &&
        !!token.keycloakSessionId))
  );
}

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && !!item) &&
    new Set(value).size === value.length
  );
}

export function isWebClientContext(value: unknown): value is WebClientContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as Record<string, any>;
  const tokens = context.tokens as Record<string, unknown> | undefined;
  return (
    /^[a-z][a-z0-9-]{0,63}$/.test(context.tool) &&
    typeof context.clientId === 'string' &&
    !!context.clientId &&
    typeof context.audience === 'string' &&
    !!context.audience &&
    typeof context.resourceServer === 'string' &&
    !!context.resourceServer &&
    context.source === 'token-exchange' &&
    !!tokens &&
    tokens.tokenType === 'Bearer' &&
    typeof tokens.accessToken === 'string' &&
    !!tokens.accessToken &&
    Number.isSafeInteger(tokens.accessExpiresAt) &&
    Number.isSafeInteger(tokens.issuedAt) &&
    (tokens.accessExpiresAt as number) > (tokens.issuedAt as number) &&
    (tokens.refreshToken === undefined ||
      (typeof tokens.refreshToken === 'string' && !!tokens.refreshToken)) &&
    (tokens.refreshExpiresIn === undefined ||
      (Number.isSafeInteger(tokens.refreshExpiresIn) &&
        (tokens.refreshExpiresIn as number) > 0)) &&
    (tokens.idToken === undefined ||
      (typeof tokens.idToken === 'string' && !!tokens.idToken)) &&
    (tokens.issuedTokenType === undefined ||
      (typeof tokens.issuedTokenType === 'string' &&
        !!tokens.issuedTokenType)) &&
    (tokens.scope === undefined || typeof tokens.scope === 'string') &&
    typeof context.subject === 'string' &&
    !!context.subject &&
    typeof context.issuer === 'string' &&
    !!context.issuer &&
    (context.azp === undefined ||
      (typeof context.azp === 'string' && !!context.azp)) &&
    (context.keycloakSessionId === undefined ||
      (typeof context.keycloakSessionId === 'string' &&
        !!context.keycloakSessionId)) &&
    isStringList(context.realmRoles) &&
    isStringList(context.clientRoles) &&
    isStringList(context.groups)
  );
}

function isClientContexts(value: unknown): value is Session['clients'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([tool, candidate]) =>
      isWebClientContext(candidate) && candidate.tool === tool,
  );
}

export function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, any>;
  return (
    v.schemaVersion === 2 &&
    Number.isSafeInteger(v.revision) &&
    v.revision >= 1 &&
    (v.status === 'active' || v.status === 'closing') &&
    typeof v.subject === 'string' &&
    !!v.subject &&
    typeof v.issuer === 'string' &&
    !!v.issuer &&
    typeof v.hubClientId === 'string' &&
    !!v.hubClientId &&
    Number.isFinite(v.createdAt) &&
    Number.isFinite(v.absoluteExpiresAt) &&
    v.absoluteExpiresAt > v.createdAt &&
    Number.isFinite(v.idleExpiresAt) &&
    v.idleExpiresAt <= v.absoluteExpiresAt &&
    Number.isFinite(v.lastActivityAt) &&
    v.lastActivityAt >= v.createdAt &&
    v.lastActivityAt <= v.idleExpiresAt &&
    isPresentationIdentity(v.identity) &&
    v.identity.sub === v.subject &&
    isTokenSet(v.primary) &&
    isClientContexts(v.clients)
  );
}

export function assertSameIdentity(
  existing: Session,
  candidate: Session,
): void {
  if (
    existing.subject !== candidate.subject ||
    existing.issuer !== candidate.issuer ||
    existing.hubClientId !== candidate.hubClientId
  )
    throw new Error('Web session identity cannot change');
}
