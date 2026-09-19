export interface WebAuthConfig {
  enabled: boolean;
  environment: string;
  issuer: string;
  internalBaseUrl?: string;
  hubClientId: string;
  hubClientType: 'public' | 'confidential';
  hubClientSecret?: string;
  callbackUrl: string;
  redisHost: string;
  redisPort: number;
  redisPassword: string;
  redisKeyPrefix: string;
  pendingTtlSeconds: number;
  sessionTtlSeconds: number;
}

function absoluteUrl(value: string | undefined, name: string): string {
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
    return url.toString().replace(/\/$/, '');
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

export function readWebAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): WebAuthConfig | null {
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
  return {
    enabled: true,
    environment,
    issuer,
    internalBaseUrl,
    hubClientId: required(env.OIDC_HUB_CLIENT_ID, 'OIDC_HUB_CLIENT_ID'),
    hubClientType,
    hubClientSecret:
      hubClientType === 'confidential' ? env.OIDC_HUB_CLIENT_SECRET : undefined,
    callbackUrl,
    redisHost: required(env.WEB_REDIS_HOST, 'WEB_REDIS_HOST'),
    redisPort: positiveInteger(env.WEB_REDIS_PORT, 'WEB_REDIS_PORT', 6379),
    redisPassword: required(env.WEB_REDIS_PASSWORD, 'WEB_REDIS_PASSWORD'),
    redisKeyPrefix,
    pendingTtlSeconds: positiveInteger(
      env.WEB_PENDING_TTL_SECONDS,
      'WEB_PENDING_TTL_SECONDS',
      600,
    ),
    sessionTtlSeconds: positiveInteger(
      env.WEB_SESSION_TTL_SECONDS,
      'WEB_SESSION_TTL_SECONDS',
      28800,
    ),
  };
}
