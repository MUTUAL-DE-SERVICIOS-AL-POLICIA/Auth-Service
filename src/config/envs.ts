import * as joi from 'joi';

interface EnvVars {
  NATS_SERVERS: string[];
  LDAP_HOST: string;
  LDAP_PORT: number;
  LDAP_ADMIN_PREFIX: string;
  LDAP_ADMIN_USERNAME: string;
  LDAP_ADMIN_PASSWORD: string;
  LDAP_BASEDN: string;
  JWT_SECRET: string;
  API_KEY: string;
  USER_TEST_DEVICE?: string;
  USER_TEST_ACCESS: boolean;
  BCB_JWT_PRIVATE_KEY?: string;
  BCB_JWT_PUBLIC_KEY?: string;
  WEB_AUTH_ENABLED: boolean;
  WEB_AUTH_ALLOW_INSECURE_HTTP: boolean;
  ENVIRONMENT?: string;
  AUTH_PUBLIC_ORIGIN?: string;
  AUTH_HUB_PORT?: string;
  CALLBACK_PATH?: string;
  KEYCLOAK_PORT?: string;
  KC_HOSTNAME?: string;
  OIDC_INTERNAL_BASE_URL?: string;
  OIDC_HUB_TOOL_KEY?: string;
  OIDC_HUB_CLIENT_ID?: string;
  OIDC_HUB_CLIENT_SECRET?: string;
  AUTH_TOOL_CLIENTS?: string;
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
    LDAP_HOST: joi.string().required(),
    LDAP_PORT: joi.number().required(),
    LDAP_ADMIN_PREFIX: joi.string().required(),
    LDAP_ADMIN_USERNAME: joi.string().required(),
    LDAP_ADMIN_PASSWORD: joi.string().required(),
    LDAP_BASEDN: joi.string().required(),
    JWT_SECRET: joi.string().required(),
    API_KEY: joi.string().required(),
    USER_TEST_DEVICE: joi.string().allow('').optional(),
    USER_TEST_ACCESS: joi.boolean().default(false),
    BCB_JWT_PRIVATE_KEY: joi.string().allow('').optional(),
    BCB_JWT_PUBLIC_KEY: joi.string().allow('').optional(),
    WEB_AUTH_ENABLED: joi.boolean().default(false),
    WEB_AUTH_ALLOW_INSECURE_HTTP: joi.boolean().default(false),
    ENVIRONMENT: joi.string().allow('').optional(),
    AUTH_PUBLIC_ORIGIN: joi.string().allow('').optional(),
    AUTH_HUB_PORT: joi.string().allow('').optional(),
    CALLBACK_PATH: joi.string().allow('').optional(),
    KEYCLOAK_PORT: joi.string().allow('').optional(),
    KC_HOSTNAME: joi.string().allow('').optional(),
    OIDC_INTERNAL_BASE_URL: joi.string().allow('').optional(),
    OIDC_HUB_TOOL_KEY: joi.string().allow('').optional(),
    OIDC_HUB_CLIENT_ID: joi.string().allow('').optional(),
    OIDC_HUB_CLIENT_SECRET: joi.string().allow('').optional(),
    AUTH_TOOL_CLIENTS: joi.string().allow('').optional(),
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

export const LegacyAuthEnvs = Object.freeze({
  environment: envVars.ENVIRONMENT,
  ldapHost: envVars.LDAP_HOST,
  ldapPort: envVars.LDAP_PORT,
  ldapAdminPrefix: envVars.LDAP_ADMIN_PREFIX,
  ldapAdminUsername: envVars.LDAP_ADMIN_USERNAME,
  ldapAdminPassword: envVars.LDAP_ADMIN_PASSWORD,
  ldapBaseDn: envVars.LDAP_BASEDN,
  jwtSecret: envVars.JWT_SECRET,
  apiKey: envVars.API_KEY,
});

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
  publicOrigin?: string;
  keycloakPort?: string;
  keycloakHostname?: string;
  hubPort?: string;
  callbackPath?: string;
  internalBaseUrl?: string;
  hubToolKey?: string;
  hubClientId?: string;
  hubClientSecret?: string;
  toolClients?: string;
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
  publicOrigin: envVars.AUTH_PUBLIC_ORIGIN,
  keycloakPort: envVars.KEYCLOAK_PORT,
  keycloakHostname: envVars.KC_HOSTNAME,
  hubPort: envVars.AUTH_HUB_PORT,
  callbackPath: envVars.CALLBACK_PATH,
  internalBaseUrl: envVars.OIDC_INTERNAL_BASE_URL,
  hubToolKey: envVars.OIDC_HUB_TOOL_KEY,
  hubClientId: envVars.OIDC_HUB_CLIENT_ID,
  hubClientSecret: envVars.OIDC_HUB_CLIENT_SECRET,
  toolClients: envVars.AUTH_TOOL_CLIENTS,
  redisHost: envVars.WEB_REDIS_HOST,
  redisPort: envVars.WEB_REDIS_PORT,
  redisPassword: envVars.WEB_REDIS_PASSWORD,
  redisKeyPrefix: envVars.WEB_REDIS_KEY_PREFIX,
  pendingTtlSeconds: envVars.WEB_PENDING_TTL_SECONDS,
  sessionTtlSeconds: envVars.WEB_SESSION_TTL_SECONDS,
  sessionIdleTtlSeconds: envVars.WEB_SESSION_IDLE_TTL_SECONDS,
  refreshSkewSeconds: envVars.WEB_REFRESH_SKEW_SECONDS,
});
