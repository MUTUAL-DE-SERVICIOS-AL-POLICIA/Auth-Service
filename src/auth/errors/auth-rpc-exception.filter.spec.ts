import { ArgumentsHost } from '@nestjs/common';
import {
  EXCEPTION_FILTERS_METADATA,
  FILTER_CATCH_EXCEPTIONS,
} from '@nestjs/common/constants';
import { RpcException } from '@nestjs/microservices';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { RpcExceptionsHandler } from '@nestjs/microservices/exceptions/rpc-exceptions-handler';
import { firstValueFrom, Observable } from 'rxjs';
import { AuthRpcExceptionFilter } from './auth-rpc-exception.filter';
import { AuthPublicError } from './auth.errors';
import { AuthController } from '../auth.controller';
import { WebAuthPatterns } from '../contracts/auth.contracts';

const knownCodes = [
  'WEB_AUTH_DISABLED',
  'INVALID_LOGIN_REQUEST',
  'LOGIN_STATE_INVALID',
  'OIDC_LOGIN_FAILED',
  'SESSION_INVALID',
  'INVALID_CLIENT_REQUEST',
  'INVALID_AUTHORIZATION_REQUEST',
  'WEB_TOOL_UNAVAILABLE',
  'WEB_CLIENT_ACCESS_DENIED',
  'WEB_CLIENT_INVALID',
  'AUTH_SERVICE_UNAVAILABLE',
] as const;

describe('AuthRpcExceptionFilter', () => {
  const filter = new AuthRpcExceptionFilter();
  const host = {} as ArgumentsHost;

  async function capture(source: Observable<unknown>): Promise<unknown> {
    try {
      await firstValueFrom(source);
    } catch (error) {
      return error;
    }
    throw new Error('Expected an RPC error');
  }

  it.each(knownCodes)('preserves the public shape for %s', async (code) => {
    const expected = new AuthPublicError(code).toResponse();
    const exception = new RpcException({
      error: { code, message: 'untrusted message' },
    });

    await expect(capture(filter.catch(exception, host))).resolves.toEqual(
      expected,
    );
  });

  it.each([
    new RpcException({
      error: { code: 'UNKNOWN_CODE', message: 'internal detail' },
    }),
    new RpcException({
      error: { code: 'SESSION_INVALID', message: 'manipulated message' },
    }),
  ])('never reflects an untrusted message', async (exception) => {
    const response = await capture(filter.catch(exception, host));

    expect(response).not.toEqual(
      expect.objectContaining({ message: expect.stringContaining('detail') }),
    );
    expect(JSON.stringify(response)).not.toMatch(/internal detail|manipulated/);
  });

  it.each([
    new Error('internal error'),
    'internal error',
    { code: 'SESSION_INVALID', message: 'internal error' },
    new RpcException('internal error'),
  ])('sanitizes an unexpected exception', async (exception) => {
    await expect(capture(filter.catch(exception, host))).resolves.toEqual(
      new AuthPublicError('AUTH_SERVICE_UNAVAILABLE').toResponse(),
    );
  });

  it('does not inspect the RPC context or invoke a logger', async () => {
    const guardedHost = new Proxy({} as ArgumentsHost, {
      get() {
        throw new Error('RPC context must not be read');
      },
    });

    await expect(
      capture(
        filter.catch(
          new RpcException(new AuthPublicError('SESSION_INVALID').toResponse()),
          guardedHost,
        ),
      ),
    ).resolves.toEqual(new AuthPublicError('SESSION_INVALID').toResponse());
  });

  it('is installed only on AuthController and catches before globals', () => {
    const controllerFilters = Reflect.getMetadata(
      EXCEPTION_FILTERS_METADATA,
      AuthController,
    ) as unknown[];
    const caughtTypes = Reflect.getMetadata(
      FILTER_CATCH_EXCEPTIONS,
      AuthRpcExceptionFilter,
    ) as unknown[];

    expect(controllerFilters).toHaveLength(1);
    expect(controllerFilters[0]).toBeInstanceOf(AuthRpcExceptionFilter);
    expect(caughtTypes).toEqual([]);
  });

  it('keeps client ensure on the filtered AuthController', () => {
    expect(
      Reflect.getMetadata(
        PATTERN_METADATA,
        AuthController.prototype.ensureClient,
      ),
    ).toEqual([WebAuthPatterns.clientEnsure]);
  });

  it('keeps client check on the filtered AuthController', () => {
    expect(
      Reflect.getMetadata(
        PATTERN_METADATA,
        AuthController.prototype.checkClient,
      ),
    ).toEqual([WebAuthPatterns.clientCheck]);
  });

  it('keeps authorization check on the filtered AuthController', () => {
    expect(
      Reflect.getMetadata(PATTERN_METADATA, AuthController.prototype.authorize),
    ).toEqual([WebAuthPatterns.authorizationCheck]);
  });

  it('prevents a later global filter from processing a handled error', async () => {
    const handler = new RpcExceptionsHandler();
    const globalCatch = jest.fn();
    handler.setCustomFilters([
      {
        func: filter.catch.bind(filter),
        exceptionMetatypes: [],
      },
      {
        func: globalCatch,
        exceptionMetatypes: [RpcException],
      },
    ]);

    const result = handler.handle(
      new RpcException(new AuthPublicError('LOGIN_STATE_INVALID').toResponse()),
      host,
    );

    await expect(capture(result)).resolves.toEqual(
      new AuthPublicError('LOGIN_STATE_INVALID').toResponse(),
    );
    expect(globalCatch).not.toHaveBeenCalled();
  });
});
