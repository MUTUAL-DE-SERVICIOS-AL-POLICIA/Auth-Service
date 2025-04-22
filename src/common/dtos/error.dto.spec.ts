import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ErrorDto } from './error.dto';

describe('ErrorDto', () => {
  it('debería ser válido con datos correctos', async () => {
    const dto = plainToInstance(ErrorDto, {
      message: 'Error encontrado',
      statusCode: 400,
      data: { error: 'Bad Request' },
      args: ['arg1', 'arg2'],
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('debería fallar si message es un número', async () => {
    const dto = plainToInstance(ErrorDto, {
      message: 123,
      statusCode: 400,
      data: {},
    });
    const errors = await validate(dto);
    const messageError = errors.find((e) => e.property === 'message');
    expect(messageError).toBeDefined();
  });

  it('debería fallar si message es una cadena vacía', async () => {
    const dto = plainToInstance(ErrorDto, {
      message: '',
      statusCode: 400,
      data: {},
    });
    const errors = await validate(dto);
    const messageError = errors.find((e) => e.property === 'message');
    expect(messageError).toBeDefined();
  });

  it('debería fallar si statusCode es negativo', async () => {
    const dto = plainToInstance(ErrorDto, {
      message: 'Error',
      statusCode: -1,
      data: {},
    });
    const errors = await validate(dto);
    const statusCodeError = errors.find((e) => e.property === 'statusCode');
    expect(statusCodeError).toBeDefined();
  });

  it('debería fallar si statusCode está ausente', async () => {
    const dto = plainToInstance(ErrorDto, {
      message: 'Error',
      data: {},
    });
    const errors = await validate(dto);
    const statusCodeError = errors.find((e) => e.property === 'statusCode');
    expect(statusCodeError).toBeDefined();
  });

  it('debería fallar si data no es un objeto', async () => {
    const dto = plainToInstance(ErrorDto, {
      message: 'Error',
      statusCode: 500,
      data: 'texto no válido',
    });
    const errors = await validate(dto);
    const dataError = errors.find((e) => e.property === 'data');
    expect(dataError).toBeDefined();
  });

  it('debería fallar si args contiene valores no string', async () => {
    const dto = plainToInstance(ErrorDto, {
      message: 'Error',
      statusCode: 500,
      data: {},
      args: ['valido', 123],
    });
    const errors = await validate(dto);

    const argsError = errors.find((e) => e.property === 'args');
    expect(argsError).toBeDefined();
  });

  it('debería ser válido si args está ausente', async () => {
    const dto = plainToInstance(ErrorDto, {
      message: 'Error',
      statusCode: 500,
      data: {},
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});
