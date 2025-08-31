import { FastifyRequest, FastifyReply } from 'fastify';

export async function apiKeyPreHandler(req: FastifyRequest, reply: FastifyReply) {
  if (!req.url.startsWith('/api/')) return;
  const provided = req.headers['x-api-key'];
  if (!provided || typeof provided !== 'string') {
    return reply.code(401).send({ error: { message: 'Missing X-Api-Key' } });
  }
  const expected = process.env.BOT_API_KEY;
  if (!expected || provided !== expected) {
    return reply.code(403).send({ error: { message: 'Invalid API key' } });
  }
}


