import { FastifyInstance } from 'fastify';
import { AppError } from '@shared/errors';

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { message: err.message, code: err.code } });
    }
    app.log.error(err);
    return reply.status(500).send({ error: { message: 'Internal server error' } });
  });
}


