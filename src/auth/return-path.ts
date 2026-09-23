import { AuthPublicError } from './errors/auth.errors';

export function normalizeHubReturnPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 2048 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('#') ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new AuthPublicError('INVALID_LOGIN_REQUEST');

  const question = value.indexOf('?');
  const rawPath = question === -1 ? value : value.slice(0, question);
  if (rawPath.includes('%') || rawPath.includes('//'))
    throw new AuthPublicError('INVALID_LOGIN_REQUEST');

  let parsed: URL;
  try {
    parsed = new URL(value, 'https://hub.invalid');
  } catch {
    throw new AuthPublicError('INVALID_LOGIN_REQUEST');
  }
  if (
    parsed.origin !== 'https://hub.invalid' ||
    (parsed.pathname !== '/apphub' &&
      !parsed.pathname.startsWith('/apphub/')) ||
    parsed.hash
  )
    throw new AuthPublicError('INVALID_LOGIN_REQUEST');

  return `${parsed.pathname}${parsed.search}`;
}
