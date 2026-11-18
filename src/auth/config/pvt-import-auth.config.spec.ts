/// <reference types="jest" />
import { createPvtImportAuthConfig } from './pvt-import-auth.config';

describe('createPvtImportAuthConfig', () => {
  it('uses the internal Keycloak origin and dedicated confidential client', () => {
    expect(
      createPvtImportAuthConfig({
        enabled: true,
        internalBaseUrl: 'http://keycloak:8080',
        pvtImportClientId: 'pvt-document-import',
        pvtImportClientSecret: 'secret',
      }),
    ).toMatchObject({
      tokenUrl:
        'http://keycloak:8080/realms/muserpol/protocol/openid-connect/token',
      userInfoUrl:
        'http://keycloak:8080/realms/muserpol/protocol/openid-connect/userinfo',
      logoutUrl:
        'http://keycloak:8080/realms/muserpol/protocol/openid-connect/logout',
      clientId: 'pvt-document-import',
      clientSecret: 'secret',
    });
  });

  it('requires a client secret', () => {
    expect(() =>
      createPvtImportAuthConfig({
        enabled: true,
        internalBaseUrl: 'http://keycloak:8080',
      }),
    ).toThrow('PVT_IMPORT_CLIENT_SECRET is required');
  });
});
