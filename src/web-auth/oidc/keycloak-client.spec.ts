/// <reference types="jest" />
import { createServer, Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { KeycloakClient } from './keycloak-client';
import { WebAuthConfig } from '../web-auth.config';

describe('KeycloakClient', () => {
  let server: Server;
  let issuer: string;
  let client: KeycloakClient;
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  let publicJwk: Record<string, unknown>;
  let discoveryCalls = 0;
  let slowDiscovery = false;

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    publicJwk = {
      ...(await exportJWK(keys.publicKey)),
      kid: 'test-key',
      alg: 'RS256',
      use: 'sig',
    };
    server = createServer((req, res) => {
      if (req.url?.endsWith('/.well-known/openid-configuration')) {
        discoveryCalls++;
        if (slowDiscovery) return;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
            token_endpoint: `${issuer}/protocol/openid-connect/token`,
            jwks_uri: `${issuer}/protocol/openid-connect/certs`,
          }),
        );
      } else if (req.url?.endsWith('/certs')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ keys: [publicJwk] }));
      } else if (req.url?.endsWith('/token')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            access_token: 'opaque-for-test',
            token_type: 'Bearer',
            expires_in: 300,
          }),
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No test server address');
    issuer = `http://127.0.0.1:${address.port}/realms/muserpol`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    slowDiscovery = false;
    client = new KeycloakClient({
      issuer,
      hubClientId: 'hub',
      hubClientType: 'public',
      callbackUrl: 'http://localhost/callback',
    } as WebAuthConfig);
  });

  async function signed(
    claims: Record<string, unknown>,
    signingIssuer = issuer,
  ) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(signingIssuer)
      .setSubject('subject-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  }

  it('caches discovery, constructs authorization URL and exchanges code', async () => {
    const before = discoveryCalls;
    const url = new URL(
      await client.authorizationUrl({
        state: 'state',
        nonce: 'nonce',
        codeChallenge: 'challenge',
      }),
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('client_id')).toBe('hub');
    expect(url.searchParams.get('nonce')).toBe('nonce');
    expect(
      (await client.exchangeAuthorizationCode('code', 'verifier')).expires_in,
    ).toBe(300);
    expect(discoveryCalls - before).toBe(1);
  });
  it('validates access token signature, issuer, azp, time, algorithm and subject', async () => {
    await expect(
      client.validateAccessToken(await signed({ azp: 'hub' })),
    ).resolves.toMatchObject({ sub: 'subject-1' });
    await expect(
      client.validateAccessToken(await signed({ aud: 'hub' })),
    ).resolves.toMatchObject({ sub: 'subject-1' });
    await expect(
      client.validateAccessToken(await signed({ azp: 'other' })),
    ).rejects.toThrow();
    await expect(
      client.validateAccessToken(
        await signed({ azp: 'hub' }, `${issuer}/wrong`),
      ),
    ).rejects.toThrow();
    await expect(
      client.validateAccessToken(
        await signed({ azp: 'hub', nbf: Math.floor(Date.now() / 1000) + 3600 }),
      ),
    ).rejects.toThrow();
    const expired = await new SignJWT({ azp: 'hub' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setSubject('subject-1')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(privateKey);
    await expect(client.validateAccessToken(expired)).rejects.toThrow();
    const noSub = await new SignJWT({ azp: 'hub' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setExpirationTime('5m')
      .sign(privateKey);
    await expect(client.validateAccessToken(noSub)).rejects.toThrow();
    const noExpiry = await new SignJWT({ azp: 'hub' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setSubject('subject-1')
      .sign(privateKey);
    await expect(client.validateAccessToken(noExpiry)).rejects.toThrow();
    const otherKeys = await generateKeyPair('RS256');
    const wrongSignature = await new SignJWT({ azp: 'hub' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setSubject('subject-1')
      .setExpirationTime('5m')
      .sign(otherKeys.privateKey);
    await expect(client.validateAccessToken(wrongSignature)).rejects.toThrow();
    const hmac = await new SignJWT({ azp: 'hub' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(issuer)
      .setSubject('subject-1')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-secret-key-for-tests'));
    await expect(client.validateAccessToken(hmac)).rejects.toThrow();
  });
  it('validates ID token audience and nonce', async () => {
    await expect(
      client.validateIdToken(await signed({ aud: 'hub', nonce: 'abc' }), 'abc'),
    ).resolves.toMatchObject({ sub: 'subject-1' });
    await expect(
      client.validateIdToken(
        await signed({ aud: 'other', nonce: 'abc' }),
        'abc',
      ),
    ).rejects.toThrow();
    await expect(
      client.validateIdToken(
        await signed({ aud: 'hub', nonce: 'wrong' }),
        'abc',
      ),
    ).rejects.toThrow();
  });
  it('times out an unresponsive discovery request', async () => {
    slowDiscovery = true;
    await expect(client.discovery()).rejects.toThrow('OIDC operation failed');
  }, 6000);
});
