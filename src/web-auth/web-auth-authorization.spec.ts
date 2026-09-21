/// <reference types="jest" />
import { KeycloakClient, OidcError } from './oidc/keycloak-client';
import { WebSession, WebClientContext } from './session/web-session';
import { WebSessionError, WebSessionStore } from './session/web-session.store';
import { PendingLoginStore } from './state/pending-login.store';
import { WebAuthConfig } from './web-auth.config';
import { WebAuthService } from './web-auth.service';
import { WebAuthPublicError } from './errors/web-auth.errors';
import { parseWebClientCatalog, resolveWebTool } from './web-client-catalog';

const sid = 's'.repeat(43);
const catalog = parseWebClientCatalog(
  JSON.stringify({
    beneficiary: {
      clientId: 'beneficiary-interface',
      audience: 'beneficiary-interface',
      resourceServer: 'beneficiary-interface',
    },
  }),
  'hub-interface',
);
const config = {
  enabled: true,
  environment: 'test',
  issuer: 'https://id.test/realms/muserpol',
  hubClientId: 'hub-interface',
  sessionTtlSeconds: 28_800,
  sessionIdleTtlSeconds: 7_200,
  refreshSkewSeconds: 120,
  clientCatalog: catalog,
  resolveWebTool: (tool: string) => resolveWebTool(catalog, tool),
} as WebAuthConfig;

function context(accessExpiresAt = Date.now() + 300_000): WebClientContext {
  return {
    tool: 'beneficiary',
    clientId: 'beneficiary-interface',
    audience: 'beneficiary-interface',
    resourceServer: 'beneficiary-interface',
    source: 'token-exchange',
    tokens: {
      tokenType: 'Bearer',
      accessToken: 'secondary-token',
      issuedAt: Date.now() - 1000,
      accessExpiresAt,
    },
    subject: 'person-1',
    issuer: config.issuer,
    realmRoles: [],
    clientRoles: ['user'],
    groups: [],
  };
}

function session(client = context()): WebSession {
  const now = Date.now();
  return {
    schemaVersion: 2,
    revision: 4,
    status: 'active',
    subject: 'person-1',
    issuer: config.issuer,
    hubClientId: config.hubClientId,
    createdAt: now - 10_000,
    absoluteExpiresAt: now + 20_000_000,
    idleExpiresAt: now + 7_000_000,
    lastActivityAt: now - 1000,
    identity: {
      sub: 'person-1',
      preferredUsername: 'operator',
      name: 'Test Operator',
    },
    primary: {
      tokenType: 'Bearer',
      accessToken: 'primary-token',
      issuedAt: now - 1000,
      accessExpiresAt: now + 300_000,
    },
    clients: { beneficiary: client },
  };
}

describe('WebAuthService authorization coordination', () => {
  let current: WebSession;
  let oidc: jest.Mocked<
    Pick<KeycloakClient, 'evaluateUmaDecision' | 'exchangeWebClientToken'>
  >;
  let sessions: jest.Mocked<Pick<WebSessionStore, 'get'>>;
  let service: WebAuthService;

  beforeEach(() => {
    current = session();
    oidc = {
      evaluateUmaDecision: jest.fn().mockResolvedValue(true),
      exchangeWebClientToken: jest.fn(),
    };
    sessions = { get: jest.fn().mockImplementation(async () => current) };
    service = new WebAuthService(
      config,
      oidc as unknown as KeycloakClient,
      {} as PendingLoginStore,
      sessions as unknown as WebSessionStore,
    );
    jest.spyOn(service, 'ensureWebClientContext').mockResolvedValue({
      authenticated: true,
      currentTool: 'beneficiary',
      currentClient: 'beneficiary-interface',
      identity: current.identity,
      realmRoles: [],
      clientRoles: ['user'],
      groups: [],
      contextExpiresAt: current.clients.beneficiary.tokens.accessExpiresAt,
      sessionExpiresAt: current.idleExpiresAt,
      sessionAbsoluteExpiresAt: current.absoluteExpiresAt,
    });
  });

  const authorize = (request: Record<string, unknown> = {}) =>
    service.checkAuthorization({
      sid,
      tool: 'beneficiary',
      resource: 'persons',
      scope: 'read',
      ...request,
    } as any);

  it('returns an approved decision with only the minimum actor', async () => {
    await expect(authorize()).resolves.toEqual({
      authorized: true,
      actor: {
        sub: 'person-1',
        preferredUsername: 'operator',
        name: 'Test Operator',
      },
    });
    expect(oidc.evaluateUmaDecision).toHaveBeenCalledWith({
      accessToken: 'secondary-token',
      target: config.resolveWebTool('beneficiary'),
      resource: 'persons',
      scope: 'read',
    });
  });

  it('returns a denied decision without actor', async () => {
    oidc.evaluateUmaDecision.mockResolvedValueOnce(false);
    await expect(authorize()).resolves.toEqual({ authorized: false });
  });

  it('does not invent optional actor fields', async () => {
    current.identity = { sub: current.subject };
    await expect(authorize()).resolves.toEqual({
      authorized: true,
      actor: { sub: current.subject },
    });
  });

  it.each([
    [
      'empty preferred username',
      { preferredUsername: '', name: 'Valid Name' },
      { name: 'Valid Name' },
    ],
    [
      'blank preferred username',
      { preferredUsername: '   ', name: 'Valid Name' },
      { name: 'Valid Name' },
    ],
    [
      'empty name',
      { preferredUsername: 'valid-user', name: '' },
      { preferredUsername: 'valid-user' },
    ],
    [
      'blank name',
      { preferredUsername: 'valid-user', name: '   ' },
      { preferredUsername: 'valid-user' },
    ],
    ['both blank', { preferredUsername: ' ', name: '\t' }, {}],
  ])(
    'omits %s without changing the persisted identity',
    async (_label, optional, expected) => {
      current.identity = { sub: current.subject, ...optional };
      const originalIdentity = { ...current.identity };
      await expect(authorize()).resolves.toEqual({
        authorized: true,
        actor: { sub: current.subject, ...expected },
      });
      expect(current.identity).toEqual(originalIdentity);
    },
  );

  it('preserves valid optional actor values without normalizing them', async () => {
    current.identity = {
      sub: current.subject,
      preferredUsername: ' valid-user ',
      name: ' Valid Name ',
    };
    await expect(authorize()).resolves.toEqual({
      authorized: true,
      actor: {
        sub: current.subject,
        preferredUsername: ' valid-user ',
        name: ' Valid Name ',
      },
    });
  });

  it('ensures the approved tool before reading its token', async () => {
    await authorize();
    expect(service.ensureWebClientContext).toHaveBeenCalledWith({
      sid,
      tool: 'beneficiary',
    });
    expect(oidc.evaluateUmaDecision).toHaveBeenCalledTimes(1);
  });

  it('uses the re-exchanged context and never authorizes with an expired token', async () => {
    current.clients.beneficiary = context(Date.now() - 1);
    (service.ensureWebClientContext as jest.Mock).mockRestore();
    Object.assign(sessions, {
      acquireClientLock: jest.fn().mockResolvedValue('client-owner'),
      releaseClientLock: jest.fn().mockResolvedValue(undefined),
      waitForRevision: jest.fn(),
      replaceClientContext: jest
        .fn()
        .mockImplementation(
          async (_sid, revision, tool, nextContext, _owner, now) => {
            if (revision !== current.revision) return 'revision_mismatch';
            current = {
              ...current,
              revision: current.revision + 1,
              lastActivityAt: now,
              idleExpiresAt: Math.min(
                current.absoluteExpiresAt,
                now + config.sessionIdleTtlSeconds * 1000,
              ),
              clients: { ...current.clients, [tool]: nextContext },
            };
            return 'updated';
          },
        ),
    });
    oidc.exchangeWebClientToken.mockResolvedValueOnce({
      accessToken: 'renewed-secondary-token',
      tokenType: 'Bearer',
      expiresIn: 300,
      expiresAt: Date.now() + 300_000,
      claims: {
        subject: current.subject,
        issuer: current.issuer,
        audience: ['beneficiary-interface'],
        azp: 'hub-interface',
        realmRoles: [],
        clientRoles: ['user'],
        groups: [],
        expiresAt: Date.now() + 300_000,
      },
    });
    const result = await authorize();
    expect(oidc.exchangeWebClientToken).toHaveBeenCalledTimes(1);
    expect((sessions as any).replaceClientContext).toHaveBeenCalledTimes(1);
    expect(current.clients.beneficiary.tokens.accessToken).toBe(
      'renewed-secondary-token',
    );
    expect(oidc.evaluateUmaDecision).toHaveBeenCalledTimes(1);
    expect(oidc.evaluateUmaDecision).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'renewed-secondary-token' }),
    );
    expect(oidc.evaluateUmaDecision).not.toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'secondary-token' }),
    );
    expect(result).toEqual({
      authorized: true,
      actor: {
        sub: 'person-1',
        preferredUsername: 'operator',
        name: 'Test Operator',
      },
    });
  });

  it.each([
    { operation: 'beneficiary.persons.read' },
    { audience: 'other' },
    { clientId: 'other' },
    { resourceServer: 'beneficiary-interface' },
    { permission: 'persons#read' },
  ])('rejects caller-controlled or additional fields', async (extra) => {
    await expect(authorize(extra)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION_REQUEST',
    });
    expect(service.ensureWebClientContext).not.toHaveBeenCalled();
    expect(oidc.evaluateUmaDecision).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown tool', { tool: 'unknown' }],
    ['invalid tool', { tool: 'Beneficiary' }],
    ['resource separator', { resource: 'persons#read' }],
    ['resource URL', { resource: 'https://example.test/persons' }],
    ['resource whitespace', { resource: 'persons records' }],
    ['resource comma', { resource: 'persons,records' }],
    ['scope separator', { scope: 'read#write' }],
    ['scope URL', { scope: 'https://example.test/read' }],
    ['scope whitespace', { scope: 'read write' }],
    ['scope comma', { scope: 'read,write' }],
    ['empty resource', { resource: '' }],
    ['empty scope', { scope: '' }],
  ])('rejects %s', async (_label, replacement) => {
    await expect(authorize(replacement)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION_REQUEST',
    });
    expect(oidc.evaluateUmaDecision).not.toHaveBeenCalled();
  });

  it('rejects a request with a non-plain prototype', async () => {
    const request = Object.assign(Object.create({ inherited: true }), {
      sid,
      tool: 'beneficiary',
      resource: 'persons',
      scope: 'read',
    });
    await expect(service.checkAuthorization(request)).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION_REQUEST',
    });
  });

  it('preserves SESSION_INVALID from context coordination', async () => {
    (service.ensureWebClientContext as jest.Mock).mockRejectedValueOnce(
      new WebAuthPublicError('SESSION_INVALID'),
    );
    await expect(authorize()).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
  });

  it('maps store and OIDC failures to a safe temporary error', async () => {
    sessions.get.mockRejectedValueOnce(new WebSessionError());
    await expect(authorize()).rejects.toMatchObject({
      code: 'SESSION_INVALID',
    });
    sessions.get.mockImplementation(async () => current);
    oidc.evaluateUmaDecision.mockRejectedValueOnce(
      new OidcError('unavailable'),
    );
    await expect(authorize()).rejects.toMatchObject({
      code: 'AUTH_SERVICE_UNAVAILABLE',
    });
  });

  it('does not log or expose tokens, SID, roles, groups or claims', async () => {
    const spies = [console.log, console.warn, console.error].map((method) =>
      jest.spyOn(console, method.name as 'log').mockImplementation(),
    );
    const result = await authorize();
    expect(result).toEqual({
      authorized: true,
      actor: {
        sub: 'person-1',
        preferredUsername: 'operator',
        name: 'Test Operator',
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /secondary-token|primary-token|realmRoles|clientRoles|groups|sid/,
    );
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });
});
