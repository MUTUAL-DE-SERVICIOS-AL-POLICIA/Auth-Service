export interface ClientCatalogEntry {
  readonly clientId: string;
  readonly audience: string;
  readonly resourceServer: string;
}

export type ClientCatalog = Readonly<
  Record<string, Readonly<ClientCatalogEntry>>
>;

export class ClientCatalogConfigError extends Error {
  constructor() {
    super('WEB_CLIENT_CATALOG is invalid');
    this.name = 'ClientCatalogConfigError';
  }
}

export class UnknownWebToolError extends Error {
  constructor() {
    super('Web tool is not configured');
    this.name = 'UnknownWebToolError';
  }
}

const TOOL_KEY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const TECHNICAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ENTRY_PROPERTIES = ['clientId'] as const;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function invalidCatalog(): never {
  throw new ClientCatalogConfigError();
}

function readTechnicalId(value: unknown): string {
  if (typeof value !== 'string' || !TECHNICAL_ID_PATTERN.test(value)) {
    invalidCatalog();
  }
  return value;
}

export function parseClientCatalog(
  raw: string | undefined,
  hubClientId: string,
): ClientCatalog {
  const source = raw === undefined ? '{}' : raw;

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    invalidCatalog();
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    invalidCatalog();
  }

  const catalog: Record<string, Readonly<ClientCatalogEntry>> = Object.create(
    null,
  ) as Record<string, Readonly<ClientCatalogEntry>>;
  const clientIds = new Set<string>();

  for (const [toolKey, rawEntry] of Object.entries(parsed)) {
    if (
      DANGEROUS_KEYS.has(toolKey) ||
      !TOOL_KEY_PATTERN.test(toolKey) ||
      rawEntry === null ||
      Array.isArray(rawEntry) ||
      typeof rawEntry !== 'object'
    ) {
      invalidCatalog();
    }

    const properties = Object.keys(rawEntry);
    if (
      properties.length !== ENTRY_PROPERTIES.length ||
      !properties.every((property) =>
        (ENTRY_PROPERTIES as readonly string[]).includes(property),
      )
    ) {
      invalidCatalog();
    }

    const values = rawEntry as Record<string, unknown>;
    const clientId = readTechnicalId(values.clientId);

    if (clientId === hubClientId || clientIds.has(clientId)) invalidCatalog();

    clientIds.add(clientId);
    catalog[toolKey] = Object.freeze({
      clientId,
      audience: clientId,
      resourceServer: clientId,
    });
  }

  return Object.freeze(catalog);
}

export function resolveTool(
  catalog: ClientCatalog,
  toolKey: string,
): Readonly<ClientCatalogEntry> {
  if (!TOOL_KEY_PATTERN.test(toolKey)) throw new UnknownWebToolError();
  const entry = catalog[toolKey];
  if (!entry) throw new UnknownWebToolError();
  return entry;
}
