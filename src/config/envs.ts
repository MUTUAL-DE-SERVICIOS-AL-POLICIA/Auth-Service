import * as joi from 'joi';

interface EnvVars {
  NATS_SERVERS: string[];
  USER_TEST_DEVICE?: string;
  USER_TEST_ACCESS: boolean;
  BCB_JWT_PRIVATE_KEY?: string;
  BCB_JWT_PUBLIC_KEY?: string;
  WEB_AUTH_ENABLED: boolean;
  WEB_AUTH_ALLOW_INSECURE_HTTP: boolean;
  ENVIRONMENT?: string;
  OIDC_ISSUER?: string;
  OIDC_INTERNAL_BASE_URL?: string;
  OIDC_HUB_TOOL_KEY?: string;
  OIDC_HUB_CLIENT_ID?: string;
  OIDC_HUB_CLIENT_SECRET?: string;
  OIDC_HUB_CALLBACK_URL?: string;
  OIDC_HUB_POST_LOGOUT_REDIRECT_URL?: string;
  WEB_CLIENT_CATALOG?: string;
  WEB_REDIS_HOST?: string;
  WEB_REDIS_PORT?: string;
  WEB_REDIS_PASSWORD?: string;
  WEB_REDIS_KEY_PREFIX?: string;
  WEB_PENDING_TTL_SECONDS?: string;
  WEB_SESSION_TTL_SECONDS?: string;
  WEB_SESSION_IDLE_TTL_SECONDS?: string;
  WEB_REFRESH_SKEW_SECONDS?: string;
}

const envsSchema = joi
  .object({
    NATS_SERVERS: joi.array().items(joi.string()).required(),
    USER_TEST_DEVICE: joi.string().allow('').optional(),
    USER_TEST_ACCESS: joi.boolean().default(false),
    BCB_JWT_PRIVATE_KEY: joi.string().allow('').optional(),
    BCB_JWT_PUBLIC_KEY: joi.string().allow('').optional(),
    WEB_AUTH_ENABLED: joi.boolean().default(false),
    WEB_AUTH_ALLOW_INSECURE_HTTP: joi.boolean().default(false),
    ENVIRONMENT: joi.string().allow('').optional(),
    OIDC_ISSUER: joi.string().allow('').optional(),
    OIDC_INTERNAL_BASE_URL: joi.string().allow('').optional(),
    OIDC_HUB_TOOL_KEY: joi.string().allow('').optional(),
    OIDC_HUB_CLIENT_ID: joi.string().allow('').optional(),
    OIDC_HUB_CLIENT_SECRET: joi.string().allow('').optional(),
    OIDC_HUB_CALLBACK_URL: joi.string().allow('').optional(),
    OIDC_HUB_POST_LOGOUT_REDIRECT_URL: joi.string().allow('').optional(),
    WEB_CLIENT_CATALOG: joi.string().allow('').optional(),
    WEB_REDIS_HOST: joi.string().allow('').optional(),
    WEB_REDIS_PORT: joi.string().allow('').optional(),
    WEB_REDIS_PASSWORD: joi.string().allow('').optional(),
    WEB_REDIS_KEY_PREFIX: joi.string().allow('').optional(),
    WEB_PENDING_TTL_SECONDS: joi.string().allow('').optional(),
    WEB_SESSION_TTL_SECONDS: joi.string().allow('').optional(),
    WEB_SESSION_IDLE_TTL_SECONDS: joi.string().allow('').optional(),
    WEB_REFRESH_SKEW_SECONDS: joi.string().allow('').optional(),
  })
  .unknown(true);

const { error, value } = envsSchema.validate({
  ...process.env,
  NATS_SERVERS: process.env.NATS_SERVERS?.split(','),
});

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

const envVars = value as EnvVars;

export const NastEnvs = {
  natsServers: envVars.NATS_SERVERS,
};

export const TestDeviceEnvs = {
  userTestDevice: envVars.USER_TEST_DEVICE,
  userTestAccess: envVars.USER_TEST_ACCESS,
};

export const BcbJwtEnvs = {
  jwtPrivateKey: envVars.BCB_JWT_PRIVATE_KEY,
  jwtPublicKey: envVars.BCB_JWT_PUBLIC_KEY,
};

export interface WebAuthEnv {
  enabled: boolean;
  allowInsecureHttp?: boolean;
  environment?: string;
  issuer?: string;
  internalBaseUrl?: string;
  hubToolKey?: string;
  hubClientId?: string;
  hubClientSecret?: string;
  callbackUrl?: string;
  postLogoutRedirectUrl?: string;
  clientCatalog?: string;
  redisHost?: string;
  redisPort?: string;
  redisPassword?: string;
  redisKeyPrefix?: string;
  pendingTtlSeconds?: string;
  sessionTtlSeconds?: string;
  sessionIdleTtlSeconds?: string;
  refreshSkewSeconds?: string;
}

export const WebAuthEnvs: Readonly<WebAuthEnv> = Object.freeze({
  enabled: envVars.WEB_AUTH_ENABLED,
  allowInsecureHttp: envVars.WEB_AUTH_ALLOW_INSECURE_HTTP,
  environment: envVars.ENVIRONMENT,
  issuer: envVars.OIDC_ISSUER,
  internalBaseUrl: envVars.OIDC_INTERNAL_BASE_URL,
  hubToolKey: envVars.OIDC_HUB_TOOL_KEY,
  hubClientId: envVars.OIDC_HUB_CLIENT_ID,
  hubClientSecret: envVars.OIDC_HUB_CLIENT_SECRET,
  callbackUrl: envVars.OIDC_HUB_CALLBACK_URL,
  postLogoutRedirectUrl: envVars.OIDC_HUB_POST_LOGOUT_REDIRECT_URL,
  clientCatalog: envVars.WEB_CLIENT_CATALOG,
  redisHost: envVars.WEB_REDIS_HOST,
  redisPort: envVars.WEB_REDIS_PORT,
  redisPassword: envVars.WEB_REDIS_PASSWORD,
  redisKeyPrefix: envVars.WEB_REDIS_KEY_PREFIX,
  pendingTtlSeconds: envVars.WEB_PENDING_TTL_SECONDS,
  sessionTtlSeconds: envVars.WEB_SESSION_TTL_SECONDS,
  sessionIdleTtlSeconds: envVars.WEB_SESSION_IDLE_TTL_SECONDS,
  refreshSkewSeconds: envVars.WEB_REFRESH_SKEW_SECONDS,
});
