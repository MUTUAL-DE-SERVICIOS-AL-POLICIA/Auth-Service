/// <reference types="jest" />
import { createServer, Server } from 'node:http';
import { exportJWK, generateKeyPair, KeyLike, SignJWT } from 'jose';
import { parseClientCatalog, resolveTool } from '../config/client-catalog';
import { WebAuthConfig } from '../config/auth.config';
import { KeycloakClient, OidcError } from './keycloak-client';

describe('KeycloakClient token exchange', () => {
  let server: Server;
  let issuer: string;
  let privateKey: KeyLike;
  let otherPrivateKey: KeyLike;
  let publicJwk: Record<string, unknown>;
  let client: KeycloakClient;
  let config: WebAuthConfig;
  let tokenStatus: number;
  let tokenResponse: unknown;
  let tokenContentType: string;
  let rawTokenResponse: string | undefined;
  let slowToken: boolean;
  let requestMethod: string | undefined;
  let requestContentType: string | undefined;
  let requestBody: string;
  let tokenRequestCount: number;
  let tokenBodyMode:
    'normal' | 'oversized-without-length' | 'misleading-length' | 'slow-body';

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    const otherKeys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    otherPrivateKey = otherKeys.privateKey;
    publicJwk = {
      ...(await exportJWK(keys.publicKey)),
      kid: 'exchange-test-key',
      alg: 'RS256',
      use: 'sig',
    };
    server = createServer((req, res) => {
      if (req.url?.endsWith('/.well-known/openid-configuration')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
            token_endpoint: `${issuer}/protocol/openid-connect/token`,
            jwks_uri: `${issuer}/protocol/openid-connect/certs`,
          }),
        );
        return;
      }
      if (req.url?.endsWith('/certs')) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      if (req.url?.endsWith('/token')) {
        tokenRequestCount += 1;
        requestMethod = req.method;
        requestContentType = req.headers['content-type'];
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
          requestBody = Buffer.concat(chunks).toString('utf8');
          if (slowToken) return;
          res.statusCode = tokenStatus;
          res.setHeader('Content-Type', tokenContentType);
          const body = rawTokenResponse ?? JSON.stringify(tokenResponse);
          if (tokenBodyMode === 'oversized-without-length') {
            res.write('{"padding":"');
            res.write('x'.repeat(70 * 1024));
            res.end('"}');
          } else if (tokenBodyMode === 'misleading-length') {
            res.setHeader('Content-Length', '16');
            res.end(body);
          } else if (tokenBodyMode === 'slow-body') {
            res.write(body.slice(0, Math.min(body.length, 16)));
          } else {
            res.end(body);
          }
        });
        return;
      }
      res.writeHead(404);
      res.end();
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

  async function signed(
    claims: Record<string, unknown> = {},
    options: {
      subject?: string;
      signingIssuer?: string;
      key?: KeyLike;
      expired?: boolean;
      expirationTime?: number | string;
    } = {},
  ): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'exchange-test-key' })
      .setIssuer(options.signingIssuer ?? issuer)
      .setSubject(options.subject ?? 'subject-1')
      .setIssuedAt()
      .setExpirationTime(
        options.expired
          ? Math.floor(Date.now() / 1000) - 1
          : (options.expirationTime ?? '5m'),
      )
      .sign(options.key ?? privateKey);
  }

  function exchange() {
    return client.exchangeWebClientToken({
      subjectToken: 'primary-access-token-for-test',
      expectedSubject: 'subject-1',
      target: config.resolveTool('beneficiary'),
    });
  }

  beforeEach(async () => {
    const clientCatalog = parseClientCatalog(
      JSON.stringify({
        beneficiary: {
          clientId: 'beneficiary-interface',
        },
      }),
      'hub-interface',
    );
    const hubTarget = Object.freeze({
      clientId: 'hub-interface',
      audience: 'hub-interface',
      resourceServer: 'hub-interface',
    });
    config = {
      issuer,
      hubToolKey: 'hub',
      hubClientId: 'hub-interface',
      hubClientSecret: 'hub-secret-for-test',
      callbackUrl: 'http://localhost/callback',
      clientCatalog,
      hubTarget,
      resolveTool: (toolKey: string) =>
        toolKey === 'hub' ? hubTarget : resolveTool(clientCatalog, toolKey),
      isKnownTarget: (target: unknown) =>
        target === hubTarget ||
        Object.values(clientCatalog).includes(target as never),
      isExchangeTarget: (target: unknown) =>
        Object.values(clientCatalog).includes(target as never),
    } as WebAuthConfig;
    client = new KeycloakClient(config);
    tokenStatus = 200;
    tokenContentType = 'application/json';
    rawTokenResponse = undefined;
    slowToken = false;
    requestMethod = undefined;
    requestContentType = undefined;
    requestBody = '';
    tokenRequestCount = 0;
    tokenBodyMode = 'normal';
    tokenResponse = {
      access_token: await signed({
        aud: 'beneficiary-interface',
        azp: 'hub-interface',
      }),
      token_type: 'bearer',
      expires_in: 300,
    };
  });

  it('sends the exact exchange form using only Hub authentication and catalog audience', async () => {
    await exchange();
    const body = new URLSearchParams(requestBody);
    expect(requestMethod).toBe('POST');
    expect(requestContentType).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(body.entries())).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      client_id: 'hub-interface',
      client_secret: 'hub-secret-for-test',
      subject_token: 'primary-access-token-for-test',
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      audience: 'beneficiary-interface',
    });
    expect(requestBody).not.toContain('beneficiary-secret');
  });

  it('accepts a minimal response and returns no unknown fields', async () => {
    tokenResponse = { ...(tokenResponse as object), ignored: 'not-returned' };
    const result = await exchange();
    expect(result).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 300,
      expiresAt: expect.any(Number),
      claims: {
        subject: 'subject-1',
        issuer,
        audience: ['beneficiary-interface'],
        azp: 'hub-interface',
        realmRoles: [],
        clientRoles: [],
        groups: [],
      },
    });
    expect(result).not.toHaveProperty('refreshToken');
    expect(result).not.toHaveProperty('idToken');
    expect(result).not.toHaveProperty('ignored');
  });

  it('never extends effective expiration beyond the verified JWT exp', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    tokenResponse = {
      ...(tokenResponse as object),
      access_token: await signed(
        { aud: 'beneficiary-interface', azp: 'hub-interface' },
        { expirationTime: exp },
      ),
      expires_in: 7200,
    };
    const result = await exchange();
    expect(result.claims.expiresAt).toBe(exp * 1000);
    expect(result.expiresAt).toBe(exp * 1000);
  });

  it('uses a shorter expires_in as the effective epoch-millisecond limit', async () => {
    const before = Date.now();
    const exp = Math.floor(before / 1000) + 3600;
    tokenResponse = {
      ...(tokenResponse as object),
      access_token: await signed(
        { aud: 'beneficiary-interface', azp: 'hub-interface' },
        { expirationTime: exp },
      ),
      expires_in: 60,
    };
    const result = await exchange();
    expect(result.claims.expiresAt).toBe(exp * 1000);
    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(result.expiresAt).toBeLessThan(result.claims.expiresAt);
    expect(result.expiresAt).toBeGreaterThan(1_000_000_000_000);
  });

  it('accepts and verifies optional refresh and ID tokens', async () => {
    tokenResponse = {
      ...(tokenResponse as object),
      refresh_token: 'opaque-refresh-for-test',
      refresh_expires_in: 600,
      id_token: await signed({ aud: 'hub-interface' }),
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'openid profile',
    };
    await expect(exchange()).resolves.toMatchObject({
      refreshToken: 'opaque-refresh-for-test',
      refreshExpiresIn: 600,
      idToken: expect.any(String),
      issuedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      scope: 'openid profile',
    });
  });

  it('accepts zero refresh expiration without a refresh token and omits it', async () => {
    tokenResponse = {
      ...(tokenResponse as object),
      refresh_expires_in: 0,
    };
    const result = await exchange();
    expect(result).not.toHaveProperty('refreshToken');
    expect(result).not.toHaveProperty('refreshExpiresIn');
  });

  it('ignores a positive refresh expiration when no refresh token exists', async () => {
    tokenResponse = {
      ...(tokenResponse as object),
      refresh_expires_in: 600,
    };
    const result = await exchange();
    expect(result).not.toHaveProperty('refreshToken');
    expect(result).not.toHaveProperty('refreshExpiresIn');
  });

  it('accepts a refresh token with a positive refresh expiration', async () => {
    tokenResponse = {
      ...(tokenResponse as object),
      refresh_token: 'opaque-refresh-for-test',
      refresh_expires_in: 600,
    };
    await expect(exchange()).resolves.toMatchObject({
      refreshToken: 'opaque-refresh-for-test',
      refreshExpiresIn: 600,
    });
  });

  it('rejects zero refresh expiration when a refresh token exists', async () => {
    tokenResponse = {
      ...(tokenResponse as object),
      refresh_token: 'opaque-refresh-for-test',
      refresh_expires_in: 0,
    };
    await expect(exchange()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid refresh expiration %s',
    async (refreshExpiresIn) => {
      tokenResponse = {
        ...(tokenResponse as object),
        refresh_expires_in: refreshExpiresIn,
      };
      await expect(exchange()).rejects.toMatchObject({
        kind: 'invalid_response',
      });
    },
  );

  it('accepts target audience with Hub azp and target azp with another audience', async () => {
    await expect(exchange()).resolves.toBeDefined();
    tokenResponse = {
      access_token: await signed({
        aud: 'account',
        azp: 'beneficiary-interface',
      }),
      token_type: 'Bearer',
      expires_in: 300,
    };
    await expect(exchange()).resolves.toBeDefined();
  });

  it('rejects unrelated audience and azp', async () => {
    tokenResponse = {
      ...(tokenResponse as object),
      access_token: await signed({ aud: 'account', azp: 'other-client' }),
    };
    await expect(exchange()).rejects.toMatchObject({ kind: 'invalid_token' });
  });

  it('compares the target audience literally without normalization', async () => {
    tokenResponse = {
      ...(tokenResponse as object),
      access_token: await signed({
        aud: ' beneficiary-interface ',
        azp: 'hub-interface',
      }),
    };
    await expect(exchange()).rejects.toMatchObject({ kind: 'invalid_token' });
  });

  const invalidTokenCases: Array<
    [
      string,
      {
        subject?: string;
        signingIssuer?: string;
        invalidKey?: boolean;
        expired?: boolean;
      },
    ]
  > = [
    ['different subject', { subject: 'subject-2' }],
    ['different issuer', { signingIssuer: 'https://issuer.invalid/realm' }],
    ['invalid signature', { invalidKey: true }],
    ['expired token', { expired: true }],
  ];

  it.each(invalidTokenCases)(
    'rejects a token with %s',
    async (_name, options) => {
      tokenResponse = {
        ...(tokenResponse as object),
        access_token: await signed(
          { aud: 'beneficiary-interface', azp: 'hub-interface' },
          {
            subject: options.subject,
            signingIssuer: options.signingIssuer,
            key: options.invalidKey ? otherPrivateKey : undefined,
            expired: options.expired,
          },
        ),
      };
      await expect(exchange()).rejects.toMatchObject({ kind: 'invalid_token' });
    },
  );

  it('extracts only target client roles and normalizes realm roles and groups', async () => {
    tokenResponse = {
      ...(tokenResponse as object),
      access_token: await signed({
        aud: ['account', 'beneficiary-interface'],
        azp: 'hub-interface',
        sid: 'keycloak-session-id',
        realm_access: { roles: ['realm-a', '', 'realm-a', ' realm-b '] },
        resource_access: {
          'beneficiary-interface': {
            roles: ['read', 'read', '', ' write '],
          },
          'other-client': { roles: ['must-not-appear'] },
        },
        groups: ['/one', '', '/one', ' /two '],
      }),
    };
    const result = await exchange();
    expect(result.claims).toMatchObject({
      sid: 'keycloak-session-id',
      realmRoles: ['realm-a', 'realm-b'],
      clientRoles: ['read', 'write'],
      groups: ['/one', '/two'],
    });
    expect(JSON.stringify(result.claims)).not.toContain('must-not-appear');
  });

  it.each([
    ['non JSON', 'text/plain', 'not-json'],
    ['JSON primitive', 'application/json', '"invalid"'],
  ])('rejects a %s token response', async (_name, contentType, body) => {
    tokenContentType = contentType;
    rawTokenResponse = body;
    await expect(exchange()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it.each([
    ['missing access token', { token_type: 'Bearer', expires_in: 300 }],
    ['missing token type', { access_token: 'value', expires_in: 300 }],
    ['missing expiration', { access_token: 'value', token_type: 'Bearer' }],
    [
      'invalid expiration',
      { access_token: 'value', token_type: 'Bearer', expires_in: 1.5 },
    ],
    [
      'unsafe expiration',
      {
        access_token: 'value',
        token_type: 'Bearer',
        expires_in: Number.MAX_SAFE_INTEGER + 1,
      },
    ],
    [
      'invalid token type',
      { access_token: 'value', token_type: 'MAC', expires_in: 300 },
    ],
    [
      'invalid issued token type',
      {
        access_token: 'value',
        token_type: 'Bearer',
        expires_in: 300,
        issued_token_type: 'urn:example:other',
      },
    ],
    [
      'unsafe refresh expiration',
      {
        access_token: 'value',
        token_type: 'Bearer',
        expires_in: 300,
        refresh_expires_in: Number.MAX_SAFE_INTEGER + 1,
      },
    ],
  ])('rejects %s', async (_name, response) => {
    tokenResponse = response;
    await expect(exchange()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it.each([
    ['invalid_grant', 'invalid_grant'],
    ['invalid_target', 'invalid_target'],
    ['unauthorized_client', 'unauthorized_client'],
    ['access_denied', 'access_denied'],
  ])(
    'classifies %s without reflecting endpoint details',
    async (code, kind) => {
      tokenStatus = 400;
      tokenResponse = {
        error: code,
        error_description: 'sensitive endpoint detail',
      };
      try {
        await exchange();
        throw new Error('expected rejection');
      } catch (error) {
        expect(error).toMatchObject({ kind, message: 'OIDC operation failed' });
        expect(String(error)).not.toContain('sensitive endpoint detail');
      }
    },
  );

  it('rejects an invalid optional ID token without returning the access token', async () => {
    tokenResponse = {
      ...(tokenResponse as object),
      id_token: await signed(
        { aud: 'hub-interface' },
        { subject: 'another-subject' },
      ),
    };
    await expect(exchange()).rejects.toMatchObject({ kind: 'invalid_token' });
  });

  it('rejects targets that were not resolved from the configured catalog', async () => {
    await expect(
      client.exchangeWebClientToken({
        subjectToken: 'primary-access-token-for-test',
        expectedSubject: 'subject-1',
        target: { ...config.clientCatalog.beneficiary },
      }),
    ).rejects.toMatchObject({ kind: 'invalid_configuration' });
    expect(requestBody).toBe('');
  });

  it('never allows token exchange toward the primary Hub target', async () => {
    await expect(
      client.exchangeWebClientToken({
        subjectToken: 'primary-access-token-for-test',
        expectedSubject: 'subject-1',
        target: config.hubTarget,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_configuration' });
    expect(requestBody).toBe('');
  });

  it('stops reading an oversized chunked response without Content-Length', async () => {
    tokenBodyMode = 'oversized-without-length';
    await expect(exchange()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('rejects an oversized response declared by Content-Length', async () => {
    tokenResponse = { padding: 'x'.repeat(70 * 1024) };
    await expect(exchange()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('rejects a safe expires_in that cannot become a safe epoch value', async () => {
    tokenResponse = {
      ...(tokenResponse as object),
      expires_in: Number.MAX_SAFE_INTEGER,
    };
    await expect(exchange()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('rejects a body whose Content-Length understates the transmitted body', async () => {
    tokenBodyMode = 'misleading-length';
    rawTokenResponse = JSON.stringify({ padding: 'x'.repeat(70 * 1024) });
    await expect(exchange()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('times out while reading an incomplete response body', async () => {
    tokenBodyMode = 'slow-body';
    await expect(exchange()).rejects.toMatchObject({ kind: 'unavailable' });
    expect(tokenRequestCount).toBe(1);
  }, 6000);

  it('times out without retrying or exposing the subject token', async () => {
    slowToken = true;
    try {
      await exchange();
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({
        kind: 'unavailable',
        message: 'OIDC operation failed',
      });
      expect(String(error)).not.toContain('primary-access-token-for-test');
    }
    expect(tokenRequestCount).toBe(1);
  }, 6000);
});
