import 'dotenv/config';
import joi from 'joi';

interface EnvVars {
  PORT: number;
  NATS_SERVERS: string[];
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
}

const envsSchema = joi
  .object({
    PORT: joi.number().required(),
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
  })
  .unknown(true);

const { error, value } = envsSchema.validate({
  ...process.env,
  NATS_SERVERS: process.env.NATS_SERVERS?.split(','),
});

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

const envVars: EnvVars = value;

export const PortEnvs = {
  port: envVars.PORT,
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

export const JwtEnvs = {
  jwtSecret: envVars.JWT_SECRET,
};
