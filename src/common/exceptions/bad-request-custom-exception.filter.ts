import {
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  BadRequestException,
  Logger,
} from '@nestjs/common';

import { throwError } from 'rxjs';
import { ErrorDto } from '../dtos/error.dto';

@Catch(BadRequestException)
export class BadRequestCustomExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('BadRequestCustomExceptionFilter');
  catch(exception: BadRequestException, host: ArgumentsHost) {
    this.logger.debug('BadRequestCustomExceptionFilter');

    const context = host.switchToRpc();
    const response: any = exception.getResponse();

    const error = new ErrorDto();
    error.message = response.message;
    error.statusCode = response.statusCode;
    error.data = context.getData();
    error.args = context.getContext().args?.filter((e) => {
      if (e != null) return e;
    });

    this.logger.error(JSON.stringify(error));

    return throwError(() => error ?? 'Internal server error');
  }
}
