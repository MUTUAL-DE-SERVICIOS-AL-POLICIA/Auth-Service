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
      audience: 'beneficiary-interface',
      resourceServer: 'beneficiary-interface',
    },
  }),
  'hub-interface',
);
const config = {
  enabled: true,
  issuer: 'https://id.test/realms/muserpol',
  hubClientId: 'hub-interface',
  refreshSkewSeconds: 120,
  sessionIdleTtlSeconds: 7200,
  clientCatalog: catalog,
  resolveTool: (tool: string) => resolveTool(catalog, tool),
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
  jest.spyOn(service, 'ensureWebClientContext').mockResolvedValue({} as never);

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
