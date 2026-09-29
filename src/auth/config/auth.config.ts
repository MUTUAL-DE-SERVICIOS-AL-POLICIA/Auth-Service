import {
  parseClientCatalog,
  resolveTool,
  ClientCatalog,
  ClientCatalogEntry,
} from './client-catalog';

export interface AuthConfig {
  enabled: boolean;
  environment: string;
  issuer: string;
  internalBaseUrl?: string;
  hubToolKey: string;
  hubClientId: string;
  hubClientType: 'public' | 'confidential';
  hubClientSecret?: string;
  callbackUrl: string;
  postLogoutRedirectUrl: string;
  redisHost: string;
  redisPort: number;
  redisPassword: string;
  redisKeyPrefix: string;
  pendingTtlSeconds: number;
  sessionTtlSeconds: number;
  sessionIdleTtlSeconds: number;
  refreshSkewSeconds: number;
  clientCatalog: ClientCatalog;
  hubTarget: Readonly<ClientCatalogEntry>;
  resolveTool(toolKey: string): Readonly<ClientCatalogEntry>;
  isKnownTarget(target: Readonly<ClientCatalogEntry>): boolean;
  isExchangeTarget(target: Readonly<ClientCatalogEntry>): boolean;
}

function absoluteUrl(
  value: string | undefined,
  name: string,
  preserveTrailingSlash = false,
): string {
  try {
    const url = new URL(value || '');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    ) {
      throw new Error();
    }
    const normalized = url.toString();
    return preserveTrailingSlash ? normalized : normalized.replace(/\/$/, '');
  } catch {
    throw new Error(
      `${name} must be an absolute HTTP(S) URL without credentials, query or fragment`,
    );
  }
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim())
    throw new Error(`${name} is required when WEB_AUTH_ENABLED=true`);
  return value.trim();
}

function positiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
): number {
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error(`${name} must be a positive integer`);
  return number;
}

export function readAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig | null {
  if (env.WEB_AUTH_ENABLED !== 'true') {
    if (env.WEB_AUTH_ENABLED && env.WEB_AUTH_ENABLED !== 'false') {
      throw new Error('WEB_AUTH_ENABLED must be true or false');
    }
    return null;
  }

  const hubClientType = required(
    env.OIDC_HUB_CLIENT_TYPE,
    'OIDC_HUB_CLIENT_TYPE',
  );
  if (hubClientType !== 'public' && hubClientType !== 'confidential') {
    throw new Error('OIDC_HUB_CLIENT_TYPE must be public or confidential');
  }
  if (hubClientType === 'confidential')
    required(env.OIDC_HUB_CLIENT_SECRET, 'OIDC_HUB_CLIENT_SECRET');
  const environment = required(env.ENVIRONMENT, 'ENVIRONMENT');
  const redisKeyPrefix = required(
    env.WEB_REDIS_KEY_PREFIX,
    'WEB_REDIS_KEY_PREFIX',
  );
  if (!/^[a-zA-Z0-9_-]+$/.test(redisKeyPrefix))
    throw new Error('WEB_REDIS_KEY_PREFIX is invalid');
  const issuer = absoluteUrl(env.OIDC_ISSUER, 'OIDC_ISSUER');
  const callbackUrl = absoluteUrl(
    env.OIDC_HUB_CALLBACK_URL,
    'OIDC_HUB_CALLBACK_URL',
  );
  const postLogoutRedirectUrl = absoluteUrl(
    env.OIDC_HUB_POST_LOGOUT_REDIRECT_URL,
    'OIDC_HUB_POST_LOGOUT_REDIRECT_URL',
    true,
  );
  const internalBaseUrl = env.OIDC_INTERNAL_BASE_URL
    ? absoluteUrl(env.OIDC_INTERNAL_BASE_URL, 'OIDC_INTERNAL_BASE_URL')
    : undefined;
  if (internalBaseUrl && new URL(internalBaseUrl).pathname !== '/') {
    throw new Error('OIDC_INTERNAL_BASE_URL must contain only an origin');
  }
  if (
    environment === 'prod' &&
    (new URL(issuer).protocol !== 'https:' ||
      new URL(callbackUrl).protocol !== 'https:')
  ) {
    throw new Error(
      'OIDC_ISSUER and OIDC_HUB_CALLBACK_URL must use HTTPS in production',
    );
  }
  const hubToolKey = required(env.OIDC_HUB_TOOL_KEY, 'OIDC_HUB_TOOL_KEY');
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(hubToolKey))
    throw new Error('OIDC_HUB_TOOL_KEY is invalid');
  const hubClientId = required(env.OIDC_HUB_CLIENT_ID, 'OIDC_HUB_CLIENT_ID');
  const clientCatalog = parseClientCatalog(env.WEB_CLIENT_CATALOG, hubClientId);
  if (Object.prototype.hasOwnProperty.call(clientCatalog, hubToolKey))
    throw new Error('OIDC_HUB_TOOL_KEY collides with WEB_CLIENT_CATALOG');
  const hubTarget = Object.freeze({
    clientId: hubClientId,
    audience: hubClientId,
    resourceServer: hubClientId,
  });
  const sessionTtlSeconds = positiveInteger(
    env.WEB_SESSION_TTL_SECONDS,
    'WEB_SESSION_TTL_SECONDS',
    28800,
  );
  const sessionIdleTtlSeconds = positiveInteger(
    env.WEB_SESSION_IDLE_TTL_SECONDS,
    'WEB_SESSION_IDLE_TTL_SECONDS',
    7200,
  );
  if (sessionIdleTtlSeconds > sessionTtlSeconds) {
    throw new Error(
      'WEB_SESSION_IDLE_TTL_SECONDS must not exceed WEB_SESSION_TTL_SECONDS',
    );
  }
  return {
    enabled: true,
    environment,
    issuer,
    internalBaseUrl,
    hubToolKey,
    hubClientId,
    hubClientType,
    hubClientSecret:
      hubClientType === 'confidential' ? env.OIDC_HUB_CLIENT_SECRET : undefined,
    callbackUrl,
    postLogoutRedirectUrl,
    redisHost: required(env.WEB_REDIS_HOST, 'WEB_REDIS_HOST'),
    redisPort: positiveInteger(env.WEB_REDIS_PORT, 'WEB_REDIS_PORT', 6379),
    redisPassword: required(env.WEB_REDIS_PASSWORD, 'WEB_REDIS_PASSWORD'),
    redisKeyPrefix,
    pendingTtlSeconds: positiveInteger(
      env.WEB_PENDING_TTL_SECONDS,
      'WEB_PENDING_TTL_SECONDS',
      600,
    ),
    sessionTtlSeconds,
    sessionIdleTtlSeconds,
    refreshSkewSeconds: positiveInteger(
      env.WEB_REFRESH_SKEW_SECONDS,
      'WEB_REFRESH_SKEW_SECONDS',
      120,
    ),
    clientCatalog,
    hubTarget,
    resolveTool: (toolKey: string) =>
      toolKey === hubToolKey ? hubTarget : resolveTool(clientCatalog, toolKey),
    isKnownTarget: (target: Readonly<ClientCatalogEntry>) =>
      target === hubTarget || Object.values(clientCatalog).includes(target),
    isExchangeTarget: (target: Readonly<ClientCatalogEntry>) =>
      Object.values(clientCatalog).includes(target),
  };
}
