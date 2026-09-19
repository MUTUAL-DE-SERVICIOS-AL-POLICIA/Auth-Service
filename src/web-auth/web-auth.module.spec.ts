/// <reference types="jest" />
import { Test } from '@nestjs/testing';
import { WebAuthModule } from './web-auth.module';
import {
  WebRedisService,
  WebStoreUnavailableError,
} from './redis/web-redis.service';

const enabled = {
  WEB_AUTH_ENABLED: 'true',
  ENVIRONMENT: 'dev',
  OIDC_ISSUER: 'http://localhost:8080/realms/muserpol',
  OIDC_HUB_CALLBACK_URL: 'http://localhost:3001/callback',
  OIDC_HUB_CLIENT_ID: 'hub',
  OIDC_HUB_CLIENT_TYPE: 'public',
  WEB_REDIS_HOST: '127.0.0.1',
  WEB_REDIS_PORT: '1',
  WEB_REDIS_KEY_PREFIX: 'web',
  WEB_REDIS_PASSWORD: 'test-redis-password',
};

describe('WebAuthModule isolation', () => {
  it('initializes while disabled without Redis configuration', async () => {
    const module = await Test.createTestingModule({
      imports: [WebAuthModule.register({ WEB_AUTH_ENABLED: 'false' })],
    }).compile();
    await expect(module.init()).resolves.toBeDefined();
    await module.close();
  });
  it('initializes while Redis is absent and fails only a web operation', async () => {
    const module = await Test.createTestingModule({
      imports: [WebAuthModule.register(enabled)],
    }).compile();
    await expect(module.init()).resolves.toBeDefined();
    const redis = module.get(WebRedisService);
    await expect(
      redis.execute((client) => client.ping()),
    ).rejects.toBeInstanceOf(WebStoreUnavailableError);
    await module.close();
  });
});
