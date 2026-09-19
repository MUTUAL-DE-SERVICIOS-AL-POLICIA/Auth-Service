export interface WebSession {
  version: number;
  subject: string;
  issuer: string;
  hubClientId: string;
  createdAt: number;
  expiresAt: number;
  hubTokens: {
    tokenType: string;
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt: number;
  };
}

export function isWebSession(value: unknown): value is WebSession {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, any>;
  const t = v.hubTokens;
  return (
    Number.isSafeInteger(v.version) &&
    v.version >= 1 &&
    typeof v.subject === 'string' &&
    !!v.subject &&
    typeof v.issuer === 'string' &&
    !!v.issuer &&
    typeof v.hubClientId === 'string' &&
    !!v.hubClientId &&
    Number.isFinite(v.createdAt) &&
    Number.isFinite(v.expiresAt) &&
    v.expiresAt > v.createdAt &&
    t &&
    typeof t === 'object' &&
    typeof t.tokenType === 'string' &&
    !!t.tokenType &&
    typeof t.accessToken === 'string' &&
    !!t.accessToken &&
    (t.refreshToken === undefined || typeof t.refreshToken === 'string') &&
    (t.idToken === undefined || typeof t.idToken === 'string') &&
    Number.isFinite(t.expiresAt)
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
