/// <reference types="jest" />
import { KeycloakClient, OidcError } from './keycloak-client';
import { WebAuthConfig } from '../web-auth.config';
import { parseWebClientCatalog, resolveWebTool } from '../web-client-catalog';

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
  issuer: 'https://id.test/realms/muserpol',
  clientCatalog: catalog,
} as WebAuthConfig;
const target = resolveWebTool(catalog, 'beneficiary');

function response(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('KeycloakClient UMA decision', () => {
  let client: KeycloakClient;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    client = new KeycloakClient(config);
    (client as any).discoveryCache = {
      value: {
        issuer: config.issuer,
        authorization_endpoint: `${config.issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${config.issuer}/protocol/openid-connect/token`,
        jwks_uri: `${config.issuer}/protocol/openid-connect/certs`,
      },
      expiresAt: Date.now() + 60_000,
    };
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  const evaluate = () =>
    client.evaluateUmaDecision({
      accessToken: 'secondary-token',
      target,
      resource: 'persons',
      scope: 'read',
    });

  it.each([
    [true, true],
    [false, false],
  ])('accepts an unequivocal result=%s', async (result, expected) => {
    fetchMock.mockResolvedValueOnce(response({ result }));
    await expect(evaluate()).resolves.toBe(expected);
    const [, init] = fetchMock.mock.calls[0];
    const body = init?.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:uma-ticket',
      audience: 'beneficiary-interface',
      permission: 'persons#read',
      response_mode: 'decision',
    });
    expect((init?.headers as Record<string, string>).authorization).toBe(
      'Bearer secondary-token',
    );
    expect(init?.redirect).toBe('error');
  });

  it.each([401, 403])(
    'treats a valid HTTP %s UMA error as denial',
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        response(
          {
            error: 'access_denied',
            error_description: 'request denied',
            error_uri: 'https://id.test/errors/access-denied',
          },
          status,
        ),
      );
      await expect(evaluate()).resolves.toBe(false);
    },
  );

  it.each([
    [{}, 401],
    [{ unexpected: 'proxy' }, 403],
    [{ result: true }, 401],
    [{ error: 'unknown_error' }, 403],
    [{ error: 42 }, 401],
    [{ error: 'access_denied', error_description: 42 }, 403],
    [{ error: 'access_denied', unexpected: 'proxy' }, 401],
  ])(
    'rejects an invalid HTTP %s OAuth/UMA error body',
    async (value, status) => {
      fetchMock.mockResolvedValueOnce(response(value, status));
      await expect(evaluate()).rejects.toMatchObject({
        kind: 'invalid_response',
      });
    },
  );

  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'APPLICATION/JSON; CHARSET=UTF-8',
  ])('accepts the exact JSON media type %s', async (contentType) => {
    fetchMock.mockResolvedValueOnce(
      response({ result: true }, 200, { 'content-type': contentType }),
    );
    await expect(evaluate()).resolves.toBe(true);
  });

  it.each([
    'text/application/json',
    'application/jsonp',
    'application/json-malformed',
  ])('rejects a similar but invalid media type %s', async (contentType) => {
    fetchMock.mockResolvedValueOnce(
      response({ result: true }, 200, { 'content-type': contentType }),
    );
    await expect(evaluate()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it.each([
    response({}),
    response({ result: 'true' }),
    response({ result: true, token: 'unexpected' }),
    new Response('not-json', { headers: { 'content-type': 'text/plain' } }),
    response({ error: 'failure' }, 500),
  ])('rejects invalid and unavailable responses safely', async (reply) => {
    fetchMock.mockResolvedValueOnce(reply);
    await expect(evaluate()).rejects.toBeInstanceOf(OidcError);
  });

  it('maps a connection failure safely without retrying', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    await expect(evaluate()).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops reading a response larger than 64 KiB', async () => {
    fetchMock.mockResolvedValueOnce(
      response({ result: true, padding: 'x'.repeat(65 * 1024) }),
    );
    await expect(evaluate()).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('bounds body reading with the request timeout and cleans its timer', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const pending = expect(evaluate()).rejects.toMatchObject({
      kind: 'unavailable',
    });
    await jest.advanceTimersByTimeAsync(3000);
    await pending;
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it('aborts a body stream that stalls after its first fragment and cleans its timer', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementationOnce((_url, init) => {
      let streamController: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          controller.enqueue(new TextEncoder().encode('{"result":'));
        },
      });
      init?.signal?.addEventListener('abort', () =>
        streamController.error(new Error('aborted')),
      );
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const pending = expect(evaluate()).rejects.toMatchObject({
      kind: 'unavailable',
    });
    await jest.advanceTimersByTimeAsync(3000);
    await pending;
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it('rejects a target object that did not come from the catalog', async () => {
    await expect(
      client.evaluateUmaDecision({
        accessToken: 'secondary-token',
        target: { ...target },
        resource: 'persons',
        scope: 'read',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_configuration' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
