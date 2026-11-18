export interface PendingLogin {
  clientId: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
  returnTo: string;
  browserBindingHash: string;
  createdAt: number;
}

export function isPendingLogin(value: unknown): value is PendingLogin {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.clientId === 'string' &&
    !!v.clientId &&
    typeof v.codeVerifier === 'string' &&
    /^[A-Za-z0-9._~-]{43,128}$/.test(v.codeVerifier) &&
    typeof v.nonce === 'string' &&
    !!v.nonce &&
    typeof v.redirectUri === 'string' &&
    !!v.redirectUri &&
    typeof v.returnTo === 'string' &&
    v.returnTo.startsWith('/') &&
    !v.returnTo.startsWith('//') &&
    !v.returnTo.includes('\\') &&
    typeof v.browserBindingHash === 'string' &&
    /^[a-f0-9]{64}$/.test(v.browserBindingHash) &&
    typeof v.createdAt === 'number' &&
    Number.isFinite(v.createdAt) &&
    v.createdAt > 0
  );
}
