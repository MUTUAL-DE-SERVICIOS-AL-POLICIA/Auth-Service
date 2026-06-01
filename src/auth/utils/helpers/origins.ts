// Helpers de URL: validación simple y extracción de origin

/** Devuelve el origin (scheme + host + puerto) de una URL válida */
export function originOf(urlStr: string): string {
  const u = new URL(urlStr);
  return `${u.protocol}//${u.host}`;
}

/** Valida si es http(s) URL con Node URL (no verifica existencia) */
export function isValidHttpUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}