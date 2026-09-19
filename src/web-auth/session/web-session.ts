import {
  isPresentationIdentity,
  PresentationIdentity,
} from '../contracts/web-auth.contracts';

export interface WebSession {
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
}

export interface WebClientContext {
  clientId: string;
  audience: string;
  source: 'token-exchange';
  tokens: WebTokenSet;
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
      Number.isFinite(token.refreshExpiresAt))
  );
}

function isClientContexts(value: unknown): value is WebSession['clients'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const context = candidate as Record<string, unknown>;
    return (
      typeof context.clientId === 'string' &&
      !!context.clientId &&
      typeof context.audience === 'string' &&
      !!context.audience &&
      context.source === 'token-exchange' &&
      isTokenSet(context.tokens)
    );
  });
}

export function isWebSession(value: unknown): value is WebSession {
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
  existing: WebSession,
  candidate: WebSession,
): void {
  if (
    existing.subject !== candidate.subject ||
    existing.issuer !== candidate.issuer ||
    existing.hubClientId !== candidate.hubClientId
  )
    throw new Error('Web session identity cannot change');
}
