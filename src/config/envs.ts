import * as joi from 'joi';

interface EnvVars {
  NATS_SERVERS: string[];
  USER_TEST_DEVICE?: string;
  USER_TEST_ACCESS: boolean;
  BCB_JWT_PRIVATE_KEY?: string;
  BCB_JWT_PUBLIC_KEY?: string;
}

const envsSchema = joi
  .object({
    NATS_SERVERS: joi.array().items(joi.string()).required(),
    USER_TEST_DEVICE: joi.string().allow('').optional(),
    USER_TEST_ACCESS: joi.boolean().default(false),
    BCB_JWT_PRIVATE_KEY: joi.string().allow('').optional(),
    BCB_JWT_PUBLIC_KEY: joi.string().allow('').optional(),
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
