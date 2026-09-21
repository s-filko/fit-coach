/**
 * Review regression proof — Task 2, server half of AC-RRP-5
 * (docs/superpowers/plans/review-regression-proof.md).
 *
 * REPRODUCTION on UNCHANGED production code: POST /api/bot/chat for a userId
 * that no longer exists. The bot's recovery contract (apps/bot/handlers.ts —
 * `isNotFound`: a 404 clears its userId cache so the next message re-upserts)
 * is only reachable if the server answers 404. The REAL route and the REAL
 * runner (buildConversationRunner behind withRunMutex, wired by
 * registerInfraServices) are used; the status is never stubbed. Today the
 * runner throws a plain `Error('User … not found')`, which the route maps to
 * 500 CORE_ERROR — the bot then keeps the stale id forever.
 *
 * Only the model beneath the gateway is scripted (the missing-user run never
 * reaches it; the positive control does). The control proves the same route +
 * runner + auth path returns 200 for an existing user.
 *
 * *.repro.test.ts is outside every default suite. Run explicitly:
 *   RUN_DB_TESTS=1 NODE_ENV=test npx jest --runInBand --testMatch='**\/review-user-recovery.repro.test.ts'
 * Promoted to *.integration.test.ts when the fix lands.
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

describe('review repro — missing user through the real runner and chat route (AC-RRP-5)', () => {
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

  it('a userId that does not exist → HTTP 404 (the status the bot recovers from)', async () => {
    const res = await postChat(randomUUID(), 'hi');

    // Unchanged code: 500 { error: { code: 'CORE_ERROR' } } — the not-found fact is a generic core error.
    expect(res.statusCode).toBe(404);
  });
});
