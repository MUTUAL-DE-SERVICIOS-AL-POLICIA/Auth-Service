// Normaliza la respuesta de UMA permissions a una lista de "resource#scope"

type UmaPermissionLike = {
  rsid?: string;
  rsname?: string;
  resource_id?: string;
  resource_name?: string;
  scopes?: string[];
  scope?: string; // por si viene un solo scope
};

export function normalizeUmaPermissions(raw: any): string[] {
  if (!raw) return [];

  const arr: UmaPermissionLike[] = Array.isArray(raw) ? raw : [raw];

  const result = new Set<string>();

  for (const p of arr) {
    if (!p) continue;

    const name =
      p.rsname ??
      p.resource_name ??
      p.rsid ??
      p.resource_id;

    if (!name) continue;

    const scopes: string[] = [];
    if (Array.isArray(p.scopes)) scopes.push(...p.scopes);
    if (typeof p.scope === 'string') scopes.push(p.scope);

    if (scopes.length === 0) {
      // permiso sin scope explícito: puedes decidir si lo ignoras o lo agregas como "name#*"
      continue;
    }

    for (const s of scopes) {
      if (typeof s !== 'string') continue;
      result.add(`${name}#${s}`);
    }
  }

  return Array.from(result);
}