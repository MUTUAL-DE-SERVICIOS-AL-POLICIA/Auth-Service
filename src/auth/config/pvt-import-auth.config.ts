import type { WebAuthEnv } from '../../config/envs';

export interface PvtImportAuthConfig {
  tokenUrl: string;
  userInfoUrl: string;
  logoutUrl: string;
  clientId: string;
  clientSecret: string;
  requestTimeoutMs: number;
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function internalOrigin(value: string | undefined): string {
  const normalized = required(value, 'OIDC_INTERNAL_BASE_URL');
  try {
    const url = new URL(normalized);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new Error(
      'OIDC_INTERNAL_BASE_URL must contain only an HTTP(S) origin',
    );
  }
}

export function createPvtImportAuthConfig(
  env: WebAuthEnv,
): PvtImportAuthConfig {
  const origin = internalOrigin(env.internalBaseUrl);
  const protocolUrl = `${origin}/realms/muserpol/protocol/openid-connect`;
  return {
    tokenUrl: `${protocolUrl}/token`,
    userInfoUrl: `${protocolUrl}/userinfo`,
    logoutUrl: `${protocolUrl}/logout`,
    clientId: env.pvtImportClientId?.trim() || 'pvt-document-import',
    clientSecret: required(
      env.pvtImportClientSecret,
      'PVT_IMPORT_CLIENT_SECRET',
    ),
    requestTimeoutMs: 10_000,
  };
}
