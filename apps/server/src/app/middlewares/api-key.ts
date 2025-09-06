import { FastifyReply, FastifyRequest } from 'fastify';

import { loadConfig } from '@config/index';

/**
 * Validates X-Api-Key header for protected routes.
 * Route selection (only /api/*) выполняется в security plugin; здесь только проверка ключа.
 */
export async function apiKeyPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const headerName = 'x-api-key';
  const raw = req.headers[headerName];
  const provided = typeof raw === 'string' ? raw.trim() : '';

  if (!provided) {
    req.log.warn({ path: req.url }, 'Missing API key');
    await reply.code(401).send({ error: { message: 'Missing X-Api-Key' } });
    return;
  }

  const { BOT_API_KEY: expected } = loadConfig();
  if (!expected || provided !== expected) {
    req.log.warn({ path: req.url }, 'Invalid API key');
    await reply.code(403).send({ error: { message: 'Invalid API key' } });
    return;
  }
}
