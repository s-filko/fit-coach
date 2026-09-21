/**
 * Missing user through the real runner and chat routes (AC-RRP-5) — promoted from
 * review-user-recovery.repro.test.ts.
 *
 * The bot's recovery contract (apps/bot/handlers.ts — `isNotFound`: a 404 clears its cached
 * userId so the next message re-registers) is only reachable if the server answers 404. The REAL
 * routes and the REAL runner (buildConversationRunner behind withRunMutex, wired by
 * registerInfraServices) are used; the status is never stubbed. The runner throws a typed
 * UserNotFoundError (code USER_NOT_FOUND, ADR-0013 §6 family); the body carries only the code.
 *
 * Only the model beneath the gateway is scripted (a missing-user run never reaches it; the
 * positive control does). The control proves the same route + runner + auth path returns 200
 * for an existing user.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { CONVERSATION_RUN_PORT_TOKEN } from '../../src/domain/conversation/ports';
import { TRAINING_SERVICE_TOKEN } from '../../src/domain/training/ports';
import { USER_SERVICE_TOKEN } from '../../src/domain/user/ports';
import { buildServer } from '../../src/app/server';
import { db } from '../../src/infra/db/drizzle';
import { DrizzleUserRepository } from '../../src/infra/db/repositories/user.repository';
import { users } from '../../src/infra/db/schema';
import { getGlobalContainer, registerInfraServices } from '../../src/main/register-infra-services';
import { createTestUserData } from '../shared/test-factories';

import { installScriptedModel } from './scenarios/scripted-model';

// Must precede the graph wiring (registerInfraServices) — see scripted-model.ts.
installScriptedModel();

describe('missing user through the real runner and chat routes (AC-RRP-5)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let conversationRun: { clearContext(userId: string): Promise<void> };
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const container = getGlobalContainer();
    await registerInfraServices(container);
    app = buildServer();
    // NOTE: CONVERSATION_RUN_PORT_TOKEN is deliberately NOT overridden — the real runner answers.
    conversationRun = container.get(CONVERSATION_RUN_PORT_TOKEN) as never;
    app.decorate('services', {
      userService: container.get(USER_SERVICE_TOKEN) as never,
      trainingService: container.get(TRAINING_SERVICE_TOKEN) as never,
      conversationRun: conversationRun as never,
    });
    await app.ready();
  });

  afterAll(async () => {
    // Only fixture records: the control user's thread (checkpoints are not FK-linked) and the user row.
    for (const id of createdUserIds) {
      await conversationRun.clearContext(id).catch(() => undefined);
      await db.delete(users).where(eq(users.id, id));
    }
    await app.close();
  });

  const postChat = (userId: string, message: string) =>
    app.inject({
      method: 'POST',
      url: '/api/bot/chat',
      headers: { 'x-api-key': process.env.BOT_API_KEY! },
      payload: { userId, message },
    });

  it('control: an existing user goes through the real runner and route → 200 with content', async () => {
    const user = await new DrizzleUserRepository().create(createTestUserData({ username: `rrp5_${Date.now()}` }));
    createdUserIds.push(user.id);

    const res = await postChat(user.id, 'hi');

    expect(res.statusCode).toBe(200);
    expect(typeof res.json().data.content).toBe('string');
  });

  it('a userId that does not exist → HTTP 404 with a code-only body (the status the bot recovers from)', async () => {
    const missing = randomUUID();

    const res = await postChat(missing, 'hi');

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'USER_NOT_FOUND' } });
    expect(res.body).not.toContain(missing); // INV-LLM-006: no exception text, no id echo
  });

  it('/chat/compact for a userId that does not exist answers the same typed 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bot/chat/compact',
      headers: { 'x-api-key': process.env.BOT_API_KEY! },
      payload: { userId: randomUUID() },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'USER_NOT_FOUND' } });
  });
});
