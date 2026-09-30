/// <reference types="jest" />
import { createWebAuthConfig } from './auth.config';

const valid = {
  enabled: true,
  environment: 'dev',
  issuer: 'http://localhost:8080/realms/muserpol',
  callbackUrl: 'http://localhost:3001/callback',
  postLogoutRedirectUrl: 'http://localhost:3001/',
  hubToolKey: 'hub',
  hubClientId: 'hub',
  hubClientType: 'public',
  redisHost: 'redis',
  redisPassword: 'test-redis-password',
  redisKeyPrefix: 'web',
  clientCatalog: '{}',
};

describe('web auth configuration', () => {
  it('does not require web variables when disabled', () => {
    expect(
      createWebAuthConfig({
        enabled: false,
        clientCatalog: '{invalid',
      }),
    ).toBeNull();
  });
  it('exposes exact catalog resolution without selecting the Hub implicitly', () => {
    const config = createWebAuthConfig({
      ...valid,
      hubClientId: 'hub-interface',
      clientCatalog: JSON.stringify({
        beneficiary: {
          clientId: 'beneficiary-interface',
        },
      }),
    });

    expect(config?.resolveTool('beneficiary')).toEqual({
      clientId: 'beneficiary-interface',
      audience: 'beneficiary-interface',
      resourceServer: 'beneficiary-interface',
    });
    expect(config?.resolveTool('hub')).toEqual({
      clientId: 'hub-interface',
      audience: 'hub-interface',
      resourceServer: 'hub-interface',
    });
    expect(() => config?.resolveTool('hub-interface')).toThrow(
      'Web tool is not configured',
    );
  });
  it('preserves the exact post logout redirect URL', () => {
    expect(createWebAuthConfig(valid)?.postLogoutRedirectUrl).toBe(
      'http://localhost:3001/',
    );
    expect(
      createWebAuthConfig({
        ...valid,
        postLogoutRedirectUrl: 'http://localhost:3001/signed-out/',
      })?.postLogoutRedirectUrl,
    ).toBe('http://localhost:3001/signed-out/');
  });
  it('requires a secret only for a confidential Hub', () => {
    expect(createWebAuthConfig(valid)?.hubClientSecret).toBeUndefined();
    expect(() =>
      createWebAuthConfig({ ...valid, hubClientType: 'confidential' }),
    ).toThrow('OIDC_HUB_CLIENT_SECRET');
    expect(
      createWebAuthConfig({
        ...valid,
        hubClientType: 'confidential',
        hubClientSecret: 'test-secret',
      })?.hubClientSecret,
    ).toBe('test-secret');
  });
  it('rejects invalid URLs without echoing input secrets', () => {
    const secret = 'do-not-print-this';
    for (const env of [
      { ...valid, issuer: `https://${secret}@example.test/realm` },
      { ...valid, callbackUrl: `not-a-url-${secret}` },
    ]) {
      try {
        createWebAuthConfig(env);
        throw new Error('expected rejection');
      } catch (error) {
        expect(String(error)).not.toContain(secret);
      }
    }
  });
  it('enforces HTTPS in production', () => {
    expect(() =>
      createWebAuthConfig({ ...valid, environment: 'prod' }),
    ).toThrow('HTTPS');
  });
  it('uses the approved refresh margin and session durations', () => {
    expect(createWebAuthConfig(valid)).toMatchObject({
      sessionTtlSeconds: 28_800,
      sessionIdleTtlSeconds: 7_200,
      refreshSkewSeconds: 120,
    });
    expect(
      createWebAuthConfig({ ...valid, refreshSkewSeconds: '90' })
        ?.refreshSkewSeconds,
    ).toBe(90);
    expect(() =>
      createWebAuthConfig({ ...valid, refreshSkewSeconds: 'invalid' }),
    ).toThrow('WEB_REFRESH_SKEW_SECONDS');
  });
  it('reads the idle timeout and rejects an idle timeout above the absolute timeout', () => {
    expect(
      createWebAuthConfig({
        ...valid,
        sessionIdleTtlSeconds: '900',
      })?.sessionIdleTtlSeconds,
    ).toBe(900);
    expect(() =>
      createWebAuthConfig({
        ...valid,
        sessionTtlSeconds: '600',
        sessionIdleTtlSeconds: '601',
      }),
    ).toThrow(
      'WEB_SESSION_IDLE_TTL_SECONDS must not exceed WEB_SESSION_TTL_SECONDS',
    );
  });
});
