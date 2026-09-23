/// <reference types="jest" />
import { Test } from '@nestjs/testing';
import { AuthModule } from './auth.module';
import {
  RedisService,
  StoreUnavailableError,
} from '../common/services/redis.service';
import { AuthController } from './auth.controller';
import { RpcException } from '@nestjs/microservices';

const enabled = {
  WEB_AUTH_ENABLED: 'true',
  ENVIRONMENT: 'dev',
  OIDC_ISSUER: 'http://localhost:8080/realms/muserpol',
  OIDC_HUB_CALLBACK_URL: 'http://localhost:3001/callback',
  OIDC_HUB_POST_LOGOUT_REDIRECT_URL: 'http://localhost:3001/',
  OIDC_HUB_CLIENT_ID: 'hub',
  OIDC_HUB_CLIENT_TYPE: 'public',
  WEB_REDIS_HOST: '127.0.0.1',
  WEB_REDIS_PORT: '1',
  WEB_REDIS_KEY_PREFIX: 'web',
  WEB_REDIS_PASSWORD: 'test-redis-password',
};

describe('AuthModule isolation', () => {
  it('initializes while disabled without Redis configuration', async () => {
    const module = await Test.createTestingModule({
      imports: [AuthModule.register({ WEB_AUTH_ENABLED: 'false' })],
    }).compile();
    await expect(module.init()).resolves.toBeDefined();
    const controller = module.get(AuthController);
    try {
      await controller.start({
        returnPath: '/apphub',
        browserBinding: 'a'.repeat(43),
      });
      throw new Error('expected disabled response');
    } catch (error) {
      expect(error).toBeInstanceOf(RpcException);
      expect((error as RpcException).getError()).toEqual({
        error: {
          code: 'WEB_AUTH_DISABLED',
          message: 'Web authentication is disabled',
        },
      });
    }
    await module.close();
  });
  it('initializes while Redis is absent and fails only a web operation', async () => {
    const module = await Test.createTestingModule({
      imports: [AuthModule.register(enabled)],
    }).compile();
    await expect(module.init()).resolves.toBeDefined();
    const redis = module.get(RedisService);
    await expect(
      redis.execute((client) => client.ping()),
    ).rejects.toBeInstanceOf(StoreUnavailableError);
    await module.close();
  });
});
