// Helpers PKCE: code_verifier + code_challenge (S256)

function base64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Genera un code_verifier (alto-entropy) válido para PKCE */
export function generateCodeVerifier(length: number = 64): string {
  // 43–128 chars. Usamos 64 por balance seguridad/compatibilidad.
  return base64url(require('crypto').randomBytes(length));
}

/** Calcula el code_challenge = base64url(SHA256(verifier)) */
export function codeChallengeS256(verifier: string): string {
  const hash = require('crypto').createHash('sha256').update(verifier).digest();
  return base64url(hash);
}

/** Atajo: devuelve { verifier, challenge } para S256 */
export function generatePkce() {
  const verifier = generateCodeVerifier();
  const challenge = codeChallengeS256(verifier);
  return { verifier, challenge, method: 'S256' as const };
}