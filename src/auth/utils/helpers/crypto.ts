// Utilidades cripto/IDs básicas para generar state y otras claves

/** Genera un ID aleatorio seguro (hex) de n bytes (por defecto 32 = 256 bits) */
export function randomId(bytes: number = 32): string {
  // Usa Node crypto para verdadera aleatoriedad
  return require('crypto').randomBytes(bytes).toString('hex');
}