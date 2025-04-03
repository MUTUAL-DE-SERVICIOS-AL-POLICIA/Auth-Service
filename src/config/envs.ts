import 'dotenv/config';
import joi from 'joi';

interface EnvVars {
  NATS_SERVERS: string[];
  DB_PASSWORD: string;
  DB_DATABASE: string;
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_SYNCHRONIZE: boolean;
  DB_SCHEMA: string;
  LDAP_AUTHENTICATION: boolean;
  LDAP_HOST: string;
  LDAP_PORT: number;
  LDAP_ADMIN_PREFIX: string;
  LDAP_ADMIN_USERNAME: string;
  LDAP_ADMIN_PASSWORD: string;
  LDAP_ACCOUNT_PREFIX: string;
  LDAP_ACCOUNT_SUFFIX: string;
  LDAP_BASEDN: string;
  JWT_SECRET: string;
  API_KEY: string;
  PVTBE_USERNAME: string;
  PVTBE_PASSWORD: string;
}

const envsSchema = joi
  .object({
    NATS_SERVERS: joi.array().items(joi.string()).required(),
    LDAP_HOST: joi.string().required(),
    LDAP_PORT: joi.number().required(),
    LDAP_ADMIN_PREFIX: joi.string().required(),
    LDAP_ADMIN_USERNAME: joi.string().required(),
    LDAP_ADMIN_PASSWORD: joi.string().required(),
    LDAP_ACCOUNT_PREFIX: joi.string().required(),
    LDAP_ACCOUNT_SUFFIX: joi.string().required(),
    LDAP_BASEDN: joi.string().required(),
    JWT_SECRET: joi.string().required(),
    API_KEY: joi.string().required(),
    DB_SYNCHRONIZE: joi.string().valid('true', 'false').default('false'),
  })
  .unknown(true);

const { error, value } = envsSchema.validate({
  ...process.env,
  NATS_SERVERS: process.env.NATS_SERVERS?.split(','),
  DB_SYNCHRONIZE: process.env.DB_SYNCHRONIZE?.toLowerCase(),
});

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

const envVars: EnvVars = {
  ...value,
  DB_SYNCHRONIZE: value.DB_SYNCHRONIZE === 'true',
};

export const NastEnvs = {
  natsServers: envVars.NATS_SERVERS,
};

export const LdapEnvs = {
  ldapAuthentication: envVars.LDAP_AUTHENTICATION,
  ldapHost: envVars.LDAP_HOST,
  ldapPort: envVars.LDAP_PORT,
  ldapAdminPrefix: envVars.LDAP_ADMIN_PREFIX,
  ldapAdminUsername: envVars.LDAP_ADMIN_USERNAME,
  ldapAdminPassword: envVars.LDAP_ADMIN_PASSWORD,
  ldapAccountPrefix: envVars.LDAP_ACCOUNT_PREFIX,
  ldapAccountSuffix: envVars.LDAP_ACCOUNT_SUFFIX,
  ldapBaseDN: envVars.LDAP_BASEDN,
};

export const SecretEnvs = {
  jwtSecret: envVars.JWT_SECRET,
  apiKey: envVars.API_KEY,
};

export const DbEnvs = {
  dbPassword: envVars.DB_PASSWORD,
  dbDatabase: envVars.DB_DATABASE,
  dbHost: envVars.DB_HOST,
  dbPort: envVars.DB_PORT,
  dbUsername: envVars.DB_USERNAME,
  dbSynchronize: envVars.DB_SYNCHRONIZE,
  dbSchema: envVars.DB_SCHEMA,
};

export const PvtbeEnvs = {
  pvtbeUsername: envVars.PVTBE_USERNAME,
  pvtbePassword: envVars.PVTBE_PASSWORD,
};
