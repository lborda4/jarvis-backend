import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string | string[];
  error?: string;
  code?: string;
  detail?: string;
  siigo?: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Error interno del servidor';

    const message = this.extractMessage(exceptionResponse);

    const body: ErrorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    };

    if (exception instanceof HttpException) {
      if (/^\/integrations\/jarvis\/payroll(?:\/|\?|$)/.test(request.url)) {
        // Guards, parameter validation and missing routes fail before PayrollService can log them.
        const detail = JSON.stringify(message).replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer [REDACTED]');
        this.logger.error(`[payroll] HTTP ${status} ${request.method} ${request.url.split('?')[0]} message=${detail}`);
      }
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null && 'error' in res) {
        body.error = String((res as Record<string, unknown>).error);
      }
      if (typeof res === 'object' && res !== null && 'code' in res) {
        body.code = String((res as Record<string, unknown>).code);
      }
      if (typeof res === 'object' && res !== null && 'detail' in res) {
        const detail = (res as Record<string, unknown>).detail;
        if (typeof detail === 'string') {
          body.detail = detail;
        }
      }
      if (typeof res === 'object' && res !== null && 'siigo' in res) {
        body.siigo = (res as Record<string, unknown>).siigo;
      }
    } else {
      body.error = 'Internal Server Error';
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  private extractMessage(
    exceptionResponse: string | object,
  ): string | string[] {
    if (typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }

    if (
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'message' in exceptionResponse
    ) {
      const message = (exceptionResponse as Record<string, unknown>).message;
      if (typeof message === 'string' || Array.isArray(message)) {
        return message;
      }
    }

    return 'Error inesperado';
  }
}
