import { FastifyInstance } from 'fastify';

import { AppError } from '@shared/errors';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    // Handle Fastify validation errors
    if (err.statusCode === 400 || err.code === 'FST_ERR_VALIDATION') {
      const validationErrors = err.validation ?? [];
      const errorMessages = validationErrors.map((v: unknown) => {
        const validationError = v as Record<string, unknown>;
        const path = (validationError.instancePath as string) ?? '';
        const message = (validationError.message as string) ?? 'Validation error';
        return path ? `${path}: ${message}` : message;
      });

      // Log validation errors at warn level
      req.log.warn({ err, statusCode: 400, code: 'VALIDATION_ERROR' }, 'validation error');

      // Check for common validation error patterns
      if (err.message?.includes('Invalid input')) {
        return reply.status(400).send({
          error: {
            message: err.message,
            code: 'VALIDATION_ERROR',
          },
        });
      }

      return reply.status(400).send({
        error: {
          message: errorMessages.length > 0 ? errorMessages.join(', ') : (err.message ?? 'Validation error'),
          code: 'VALIDATION_ERROR',
        },
      });
    }

    // Handle other Fastify errors
    if (err.statusCode) {
      req.log.warn({ err, statusCode: err.statusCode, code: err.code }, 'request error');
      return reply.status(err.statusCode).send({
        error: {
          message: err.message || 'Request error',
          code: err.code || 'REQUEST_ERROR',
        },
      });
    }

    // Handle custom AppError
    if (err instanceof AppError) {
      req.log.warn({ err, statusCode: err.statusCode, code: err.code }, 'app error');
      return reply.status(err.statusCode || 500).send({
        error: {
          message: err.message,
          code: err.code,
        },
      });
    }

    // Handle unknown errors
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
    });
  });
}

