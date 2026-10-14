import type { WebAuthEnv } from '../../config/envs';
import {
  parseClientCatalog,
  resolveTool,
  ClientCatalog,
  ClientCatalogEntry,
} from './client-catalog';

export interface WebAuthConfig {
  enabled: boolean;
  environment: string;
  issuer: string;
  internalBaseUrl?: string;
  hubToolKey: string;
  hubClientId: string;
  hubClientSecret: string;
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

export function createWebAuthConfig(env: WebAuthEnv): WebAuthConfig | null {
  if (!env.enabled) return null;

  const hubClientSecret = required(
    env.hubClientSecret,
    'OIDC_HUB_CLIENT_SECRET',
  );
  const environment = required(env.environment, 'ENVIRONMENT');
  const redisKeyPrefix = env.redisKeyPrefix?.trim() || 'muserpol-web';
  if (!/^[a-zA-Z0-9_-]+$/.test(redisKeyPrefix))
    throw new Error('WEB_REDIS_KEY_PREFIX is invalid');
  const issuer = absoluteUrl(env.issuer, 'OIDC_ISSUER');
  const callbackUrl = absoluteUrl(env.callbackUrl, 'OIDC_HUB_CALLBACK_URL');
  const postLogoutRedirectUrl = absoluteUrl(
    env.postLogoutRedirectUrl,
    'OIDC_HUB_POST_LOGOUT_REDIRECT_URL',
    true,
  );
  const internalBaseUrl = env.internalBaseUrl
    ? absoluteUrl(env.internalBaseUrl, 'OIDC_INTERNAL_BASE_URL')
    : undefined;
  if (internalBaseUrl && new URL(internalBaseUrl).pathname !== '/') {
    throw new Error('OIDC_INTERNAL_BASE_URL must contain only an origin');
  }
  if (
    environment === 'prod' &&
    !env.allowInsecureHttp &&
    (new URL(issuer).protocol !== 'https:' ||
      new URL(callbackUrl).protocol !== 'https:')
  ) {
    throw new Error(
      'OIDC_ISSUER and OIDC_HUB_CALLBACK_URL must use HTTPS in production unless WEB_AUTH_ALLOW_INSECURE_HTTP=true',
    );
  }
  const hubToolKey = env.hubToolKey?.trim() || 'hub';
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(hubToolKey))
    throw new Error('OIDC_HUB_TOOL_KEY is invalid');
  const hubClientId = env.hubClientId?.trim() || 'hub-interface';
  const clientCatalog = parseClientCatalog(env.clientCatalog, hubClientId);
  if (Object.prototype.hasOwnProperty.call(clientCatalog, hubToolKey))
    throw new Error('OIDC_HUB_TOOL_KEY collides with WEB_CLIENT_CATALOG');
  const hubTarget = Object.freeze({
    clientId: hubClientId,
    audience: hubClientId,
    resourceServer: hubClientId,
  });
  const sessionTtlSeconds = positiveInteger(
    env.sessionTtlSeconds,
    'WEB_SESSION_TTL_SECONDS',
    28800,
  );
  const sessionIdleTtlSeconds = positiveInteger(
    env.sessionIdleTtlSeconds,
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
    hubClientSecret,
    callbackUrl,
    postLogoutRedirectUrl,
    redisHost: env.redisHost?.trim() || 'redis',
    redisPort: positiveInteger(env.redisPort, 'WEB_REDIS_PORT', 6379),
    redisPassword: required(env.redisPassword, 'WEB_REDIS_PASSWORD'),
    redisKeyPrefix,
    pendingTtlSeconds: positiveInteger(
      env.pendingTtlSeconds,
      'WEB_PENDING_TTL_SECONDS',
      600,
    ),
    sessionTtlSeconds,
    sessionIdleTtlSeconds,
    refreshSkewSeconds: positiveInteger(
      env.refreshSkewSeconds,
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
