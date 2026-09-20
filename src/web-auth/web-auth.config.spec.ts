/// <reference types="jest" />
import { readWebAuthConfig } from './web-auth.config';

const valid = {
  WEB_AUTH_ENABLED: 'true',
  ENVIRONMENT: 'dev',
  OIDC_ISSUER: 'http://localhost:8080/realms/muserpol',
  OIDC_HUB_CALLBACK_URL: 'http://localhost:3001/callback',
  OIDC_HUB_CLIENT_ID: 'hub',
  OIDC_HUB_CLIENT_TYPE: 'public',
  WEB_REDIS_HOST: 'redis',
  WEB_REDIS_PASSWORD: 'test-redis-password',
  WEB_REDIS_KEY_PREFIX: 'web',
  WEB_CLIENT_CATALOG: '{}',
};

describe('web auth configuration', () => {
  it('does not require web variables when disabled', () => {
    expect(
      readWebAuthConfig({
        WEB_AUTH_ENABLED: 'false',
        WEB_CLIENT_CATALOG: '{invalid',
      }),
    ).toBeNull();
  });
  it('exposes exact catalog resolution without selecting the Hub implicitly', () => {
    const config = readWebAuthConfig({
      ...valid,
      OIDC_HUB_CLIENT_ID: 'hub-interface',
      WEB_CLIENT_CATALOG: JSON.stringify({
        beneficiary: {
          clientId: 'beneficiary-interface',
          audience: 'beneficiary-interface',
          resourceServer: 'beneficiary-interface',
        },
      }),
    });

    expect(config?.resolveWebTool('beneficiary')).toEqual({
      clientId: 'beneficiary-interface',
      audience: 'beneficiary-interface',
      resourceServer: 'beneficiary-interface',
    });
    expect(() => config?.resolveWebTool('hub-interface')).toThrow(
      'Web tool is not configured',
    );
  });
  it('requires a secret only for a confidential Hub', () => {
    expect(readWebAuthConfig(valid)?.hubClientSecret).toBeUndefined();
    expect(() =>
      readWebAuthConfig({ ...valid, OIDC_HUB_CLIENT_TYPE: 'confidential' }),
    ).toThrow('OIDC_HUB_CLIENT_SECRET');
    expect(
      readWebAuthConfig({
        ...valid,
        OIDC_HUB_CLIENT_TYPE: 'confidential',
        OIDC_HUB_CLIENT_SECRET: 'test-secret',
      })?.hubClientSecret,
    ).toBe('test-secret');
  });
  it('rejects invalid URLs without echoing input secrets', () => {
    const secret = 'do-not-print-this';
    for (const env of [
      { ...valid, OIDC_ISSUER: `https://${secret}@example.test/realm` },
      { ...valid, OIDC_HUB_CALLBACK_URL: `not-a-url-${secret}` },
    ]) {
      try {
        readWebAuthConfig(env);
        throw new Error('expected rejection');
      } catch (error) {
        expect(String(error)).not.toContain(secret);
      }
    }
  });
  it('enforces HTTPS in production', () => {
    expect(() => readWebAuthConfig({ ...valid, ENVIRONMENT: 'prod' })).toThrow(
      'HTTPS',
    );
  });
  it('uses the approved refresh margin and session durations', () => {
    expect(readWebAuthConfig(valid)).toMatchObject({
      sessionTtlSeconds: 28_800,
      sessionIdleTtlSeconds: 7_200,
      refreshSkewSeconds: 120,
    });
    expect(
      readWebAuthConfig({ ...valid, WEB_REFRESH_SKEW_SECONDS: '90' })
        ?.refreshSkewSeconds,
    ).toBe(90);
    expect(() =>
      readWebAuthConfig({ ...valid, WEB_REFRESH_SKEW_SECONDS: 'invalid' }),
    ).toThrow('WEB_REFRESH_SKEW_SECONDS');
  });
});
