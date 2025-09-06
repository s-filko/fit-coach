import { FastifyInstance } from 'fastify';
import { AppError } from '@shared/errors';

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    // Handle Fastify validation errors
    if (err.statusCode === 400 || err.code === 'FST_ERR_VALIDATION') {
      const validationErrors = err.validation ?? [];
      const errorMessages = validationErrors.map((v: any) => {
        const path = v.instancePath ?? '';
        const message = v.message ?? 'Validation error';
        return path ? `${path}: ${message}` : message;
      });

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
      return reply.status(err.statusCode).send({
        error: {
          message: err.message || 'Request error',
          code: err.code || 'REQUEST_ERROR',
        },
      });
    }

    // Handle custom AppError
    if (err instanceof AppError) {
      return reply.status(err.statusCode || 500).send({
        error: {
          message: err.message,
          code: err.code,
        },
      });
    }

    // Handle unknown errors
    app.log.error(err);
    return reply.status(500).send({
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
    });
  });
}

