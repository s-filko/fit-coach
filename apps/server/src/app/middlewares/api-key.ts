import { FastifyReply, FastifyRequest } from 'fastify';

import { loadConfig } from '@config/index';

/**
 * Validates X-Api-Key header for protected routes.
 * Route selection (only /api/*) выполняется в security plugin; здесь только проверка ключа.
 */

const API_KEY_HEADER = 'x-api-key' as const;

function extractApiKey(request: FastifyRequest): string {
  const raw = request.headers[API_KEY_HEADER];
  return typeof raw === 'string' ? raw.trim() : '';
}

async function sendUnauthorized(reply: FastifyReply, message: string): Promise<void> {
  await reply.code(401).send({ error: { message } });
}

async function sendForbidden(reply: FastifyReply, message: string): Promise<void> {
  await reply.code(403).send({ error: { message } });
}

export async function apiKeyPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const provided = extractApiKey(req);

  if (!provided) {
    req.log.warn({ path: req.url }, 'Missing API key');
    await sendUnauthorized(reply, 'Missing X-Api-Key');
    return;
  }

  const { BOT_API_KEY: expected } = loadConfig();
  if (!expected || provided !== expected) {
    req.log.warn({ path: req.url }, 'Invalid API key');
    await sendForbidden(reply, 'Invalid API key');
    return;
  }
}
