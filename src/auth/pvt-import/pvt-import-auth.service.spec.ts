/// <reference types="jest" />
import { RpcException } from '@nestjs/microservices';
import { PvtImportAuthService } from './pvt-import-auth.service';

describe('PvtImportAuthService', () => {
  const config = {
    tokenUrl: 'http://keycloak/token',
    userInfoUrl: 'http://keycloak/userinfo',
    logoutUrl: 'http://keycloak/logout',
    clientId: 'pvt-document-import',
    clientSecret: 'secret',
    requestTimeoutMs: 1000,
  };
  const service = new PvtImportAuthService(config);

  beforeEach(() => jest.restoreAllMocks());

  it('validates credentials, returns the operator and closes the technical session', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            preferred_username: 'operator',
            name: 'Test Operator',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      service.validateCredentials('operator', 'password'),
    ).resolves.toEqual({
      user: { username: 'operator', name: 'Test Operator' },
      access: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe(config.logoutUrl);
  });

  it('maps invalid Keycloak credentials to unauthorized', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 401,
      }),
    );

    await expect(
      service.validateCredentials('operator', 'bad-password'),
    ).rejects.toBeInstanceOf(RpcException);
  });

  it('does not fail a successful validation when session cleanup fails', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ preferred_username: 'operator' }), {
          status: 200,
        }),
      )
      .mockRejectedValueOnce(new Error('logout unavailable'));

    await expect(
      service.validateCredentials('operator', 'password'),
    ).resolves.toEqual({
      user: { username: 'operator', name: 'operator' },
      access: [],
    });
  });
});
