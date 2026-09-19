import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomOpaqueId(): string {
  return randomBytes(32).toString('base64url');
}

export function createPkce(): {
  verifier: string;
  challenge: string;
  method: 'S256';
} {
  const verifier = randomOpaqueId();
  return { verifier, challenge: codeChallengeS256(verifier), method: 'S256' };
}

export function codeChallengeS256(verifier: string): string {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))
    throw new Error('Invalid PKCE verifier');
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function hashBrowserBinding(binding: string): string {
  return createHash('sha256').update(binding).digest('hex');
}

export function verifyBrowserBinding(
  binding: string,
  expectedHash: string,
): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(
    Buffer.from(hashBrowserBinding(binding), 'hex'),
    Buffer.from(expectedHash, 'hex'),
  );
}

export const createState = randomOpaqueId;
export const createNonce = randomOpaqueId;
export const createBrowserBinding = randomOpaqueId;
export const createSid = randomOpaqueId;
