

/** Decodifica base64url correctamente */
function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

/**
 * Decodifica el payload de un JWT (sin verificar)
 */
export function peekJwtPayload<T = any>(jwt: string): T {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('JWT mal formado');
  }

  const payload = base64UrlDecode(parts[1]);
  return JSON.parse(payload) as T;
}

/**
 * Extrae el subject (sub) del token
 */
export function peekSub(jwt: string): string | undefined {
  try {
    return (peekJwtPayload(jwt) as any)?.sub;
  } catch {
    return undefined;
  }
}

/**
 * Extrae roles desde:
 * - realm_access.roles
 * - resource_access[clientId].roles
 */
export function peekRoles(jwt: string, clientId?: string): string[] {
  try {
    const payload: any = peekJwtPayload(jwt);

    const realmRoles = Array.isArray(payload?.realm_access?.roles)
      ? payload.realm_access.roles
      : [];

    const clientRoles = clientId && Array.isArray(payload?.resource_access?.[clientId]?.roles)
      ? payload.resource_access[clientId].roles
      : [];

    return Array.from(new Set<string>([...realmRoles, ...clientRoles]));
  } catch {
    return [];
  }
}

/**
 * Extrae información básica de perfil desde el access_token
 */
export function peekUserProfile(jwt: string): {
  sub?: string;
  preferred_username?: string;
  username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
} | undefined {
  try {
    const payload: any = peekJwtPayload(jwt);

    return {
      sub: payload?.sub,
      preferred_username: payload?.preferred_username,
      username: payload?.preferred_username ?? payload?.username,
      name: payload?.name,
      given_name: payload?.given_name,
      family_name: payload?.family_name,
      email: payload?.email,
    };
  } catch {
    return undefined;
  }
}