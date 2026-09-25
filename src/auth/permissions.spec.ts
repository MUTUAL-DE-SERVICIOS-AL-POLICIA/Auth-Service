/// <reference types="jest" />
import { AuthService } from './auth.service';
import { KeycloakClient } from './oidc/keycloak-client';
import { PendingLoginStore } from './state/pending-login.store';
import { SessionStore } from './session/session.store';
import { AuthConfig } from './config/auth.config';
import { parseClientCatalog, resolveTool } from './config/client-catalog';
import { Session } from './session/session';

const sid = 's'.repeat(43);
const catalog = parseClientCatalog(
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
const config = {
  enabled: true,
  issuer: 'https://id.test/realms/muserpol',
  hubToolKey: 'hub',
  hubClientId: 'hub-interface',
  refreshSkewSeconds: 120,
  sessionIdleTtlSeconds: 7200,
  clientCatalog: catalog,
  hubTarget,
  resolveTool: (tool: string) =>
    tool === 'hub' ? hubTarget : resolveTool(catalog, tool),
  isKnownTarget: (target: unknown) =>
    target === hubTarget || Object.values(catalog).includes(target as never),
} as AuthConfig;

it('returns only normalized permissions with session-bounded expirations', async () => {
  const now = Date.now();
  const session = {
    schemaVersion: 2,
    revision: 3,
    status: 'active',
    subject: 'person-1',
    issuer: config.issuer,
    hubClientId: config.hubClientId,
    createdAt: now - 1000,
    absoluteExpiresAt: now + 600000,
    idleExpiresAt: now + 300000,
    lastActivityAt: now,
    identity: { sub: 'person-1' },
    primary: {
      tokenType: 'Bearer',
      accessToken: 'primary',
      issuedAt: now - 1000,
      accessExpiresAt: now + 200000,
    },
    clients: {
      beneficiary: {
        tool: 'beneficiary',
        clientId: 'beneficiary-interface',
        audience: 'beneficiary-interface',
        resourceServer: 'beneficiary-interface',
        source: 'token-exchange',
        subject: 'person-1',
        issuer: config.issuer,
        realmRoles: [],
        clientRoles: [],
        groups: [],
        tokens: {
          tokenType: 'Bearer',
          accessToken: 'secondary',
          issuedAt: now - 1000,
          accessExpiresAt: now + 180000,
        },
      },
    },
  } as Session;
  const oidc = {
    getUmaPermissions: jest
      .fn()
      .mockResolvedValue([{ resource: 'persons', scopes: ['read'] }]),
  };
  const sessions = { get: jest.fn().mockResolvedValue(session) };
  const service = new AuthService(
    config,
    oidc as unknown as KeycloakClient,
    {} as PendingLoginStore,
    sessions as unknown as SessionStore,
  );
  jest.spyOn(service, 'ensureWebClientContext').mockResolvedValue({
    authenticated: true,
    currentTool: 'beneficiary',
    currentClient: 'beneficiary-interface',
    identity: session.identity,
    realmRoles: [],
    clientRoles: [],
    groups: [],
    contextExpiresAt: session.clients.beneficiary.tokens.accessExpiresAt,
    sessionExpiresAt: session.idleExpiresAt,
    sessionAbsoluteExpiresAt: session.absoluteExpiresAt,
  });

  await expect(
    service.getWebClientContext({ sid, tool: 'beneficiary' }),
  ).resolves.toEqual({
    authenticated: true,
    currentTool: 'beneficiary',
    currentClient: 'beneficiary-interface',
    identity: session.identity,
    realmRoles: [],
    clientRoles: [],
    groups: [],
    permissions: [{ resource: 'persons', scopes: ['read'] }],
    contextExpiresAt: session.clients.beneficiary.tokens.accessExpiresAt,
    permissionsExpiresAt: session.clients.beneficiary.tokens.accessExpiresAt,
    sessionExpiresAt: session.idleExpiresAt,
    sessionAbsoluteExpiresAt: session.absoluteExpiresAt,
  });
  expect(oidc.getUmaPermissions).toHaveBeenCalledWith({
    accessToken: 'secondary',
    target: resolveTool(catalog, 'beneficiary'),
  });
});

it('returns Hub permissions from the primary context without token exchange', async () => {
  const now = Date.now();
  const session = {
    schemaVersion: 2,
    revision: 1,
    status: 'active',
    subject: 'person-1',
    issuer: config.issuer,
    hubClientId: config.hubClientId,
    createdAt: now - 1_000,
    absoluteExpiresAt: now + 600_000,
    idleExpiresAt: now + 300_000,
    lastActivityAt: now - 1_000,
    identity: { sub: 'person-1', name: 'Hub User' },
    primary: {
      tokenType: 'Bearer',
      accessToken: 'primary-access-token',
      issuedAt: now - 1_000,
      accessExpiresAt: now + 300_000,
    },
    clients: {},
  } as Session;
  const oidc = {
    validateToolAccessToken: jest.fn().mockResolvedValue({
      subject: session.subject,
      issuer: session.issuer,
      audience: ['account'],
      azp: 'hub-interface',
      realmRoles: ['realm-user'],
      clientRoles: ['hub-user'],
      groups: ['/staff'],
      expiresAt: session.primary.accessExpiresAt,
    }),
    getUmaPermissions: jest
      .fn()
      .mockResolvedValue([
        { resource: 'beneficiary-interface', scopes: ['launch'] },
      ]),
    exchangeWebClientToken: jest.fn(),
  };
  const sessions = {
    get: jest.fn().mockResolvedValue(session),
    replace: jest.fn().mockResolvedValue(true),
  };
  const service = new AuthService(
    config,
    oidc as unknown as KeycloakClient,
    {} as PendingLoginStore,
    sessions as unknown as SessionStore,
  );

  await expect(
    service.getWebClientContext({ sid, tool: 'hub' }),
  ).resolves.toMatchObject({
    authenticated: true,
    currentTool: 'hub',
    currentClient: 'hub-interface',
    identity: session.identity,
    realmRoles: ['realm-user'],
    clientRoles: ['hub-user'],
    groups: ['/staff'],
    permissions: [{ resource: 'beneficiary-interface', scopes: ['launch'] }],
  });
  expect(oidc.validateToolAccessToken).toHaveBeenCalledWith(
    'primary-access-token',
    session.subject,
    hubTarget,
  );
  expect(oidc.getUmaPermissions).toHaveBeenCalledWith({
    accessToken: 'primary-access-token',
    target: hubTarget,
  });
  expect(oidc.exchangeWebClientToken).not.toHaveBeenCalled();
});
