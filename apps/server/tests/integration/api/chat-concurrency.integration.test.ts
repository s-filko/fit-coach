import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { buildServer } from '../../../src/app/server';
import {
  CONVERSATION_RUN_PORT_TOKEN,
  CONVERSATION_RUN_SERVICE_TOKEN,
  type ConversationRunPort,
  type IConversationRunService,
  type RunInput,
  type RunResult,
} from '../../../src/domain/conversation/ports';
import { TRAINING_SERVICE_TOKEN } from '../../../src/domain/training/ports';
import { type IUserService, USER_SERVICE_TOKEN } from '../../../src/domain/user/ports';
import { withRunMutex } from '../../../src/infra/conversation/with-run-mutex';
import { db } from '../../../src/infra/db/drizzle';
import { conversationRuns } from '../../../src/infra/db/schema';
import { getGlobalContainer, registerInfraServices } from '../../../src/main/register-infra-services';

// AC-1351: two concurrent POST /api/bot/chat for the same userId execute
// sequentially through the per-userId mutex (D-A, D-12); different userIds
// run concurrently. Follows the harness in chat.routes.integration.test.ts
// (buildServer + app.inject, CONVERSATION_RUN_PORT_TOKEN overridden in the
// container) — no RUN_DB_TESTS gate is used because none exists in that file;
// .env.test already sets RUN_DB_TESTS=1 globally, which is what makes a real
// Postgres available in this suite (verified: setup.ts drops/recreates the
// schema and applies migrations whenever that flag is set).
const SIMULATED_LATENCY_MS = 200;

describe('POST /api/bot/chat concurrency — AC-1351', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let runService: IConversationRunService;
  let userService: IUserService;

  const makeSlowPort = (): ConversationRunPort => ({
    run: async (input: RunInput): Promise<RunResult> => {
      const runId = randomUUID();
      const createdAt = new Date();
      await new Promise(resolve => setTimeout(resolve, SIMULATED_LATENCY_MS));
      await runService.recordRun({
        runId,
        userId: input.userId,
        phaseIn: 'chat',
        phaseOut: null,
        model: 'stub-model',
        trigger: 'user_message',
        client: 'telegram',
        promptVersions: {},
        tokensIn: 1,
        tokensOut: 1,
        latencyMs: Date.now() - createdAt.getTime(),
        toolCalls: null,
        transition: null,
        outcome: 'ok',
        budgetReport: null,
      });
      return { text: `reply for ${input.userId}`, phase: 'chat', runId };
    },
    clearContext: async () => undefined,
  });

  beforeAll(async () => {
    const container = getGlobalContainer();
    await registerInfraServices(container);
    runService = container.get(CONVERSATION_RUN_SERVICE_TOKEN);
    userService = container.get(USER_SERVICE_TOKEN);

    app = buildServer();
    container.register(CONVERSATION_RUN_PORT_TOKEN, withRunMutex(makeSlowPort(), { waitMs: 5000 }));

    app.decorate('services', {
      userService: container.get(USER_SERVICE_TOKEN) as never,
      trainingService: container.get(TRAINING_SERVICE_TOKEN) as never,
      conversationRun: container.get(CONVERSATION_RUN_PORT_TOKEN) as never,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function runRowsFor(userId: string): Promise<(typeof conversationRuns.$inferSelect)[]> {
    return db.select().from(conversationRuns).where(eq(conversationRuns.userId, userId));
  }

  it('AC-1351: same userId — the two run rows do not overlap in [created_at, created_at + latency_ms]', async () => {
    const user = await userService.upsertUser({
      provider: 'test',
      providerUserId: `ac-1351-same-${Date.now()}`,
    });

    const validKey = process.env.BOT_API_KEY!;
    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/bot/chat',
        headers: { 'x-api-key': validKey },
        payload: { userId: user.id, message: 'first' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/bot/chat',
        headers: { 'x-api-key': validKey },
        payload: { userId: user.id, message: 'second' },
      }),
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const rows = await runRowsFor(user.id);
    expect(rows).toHaveLength(2);

    const windows = rows
      .map(row => {
        const start = row.createdAt.getTime();
        return { start, end: start + row.latencyMs };
      })
      .sort((a, b) => a.start - b.start);

    // Non-overlapping: the second window must start at or after the first ends.
    expect(windows[1].start).toBeGreaterThanOrEqual(windows[0].end);
  });

  it('AC-1351: different userIds — the two run rows DO overlap', async () => {
    const [userA, userB] = await Promise.all([
      userService.upsertUser({ provider: 'test', providerUserId: `ac-1351-a-${Date.now()}` }),
      userService.upsertUser({ provider: 'test', providerUserId: `ac-1351-b-${Date.now()}` }),
    ]);

    const validKey = process.env.BOT_API_KEY!;
    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/bot/chat',
        headers: { 'x-api-key': validKey },
        payload: { userId: userA.id, message: 'hi' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/bot/chat',
        headers: { 'x-api-key': validKey },
        payload: { userId: userB.id, message: 'hi' },
      }),
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const [rowsA] = await runRowsFor(userA.id);
    const [rowsB] = await runRowsFor(userB.id);

    const windowA = { start: rowsA.createdAt.getTime(), end: rowsA.createdAt.getTime() + rowsA.latencyMs };
    const windowB = { start: rowsB.createdAt.getTime(), end: rowsB.createdAt.getTime() + rowsB.latencyMs };

    // Overlap: each window starts before the other ends.
    expect(windowA.start).toBeLessThan(windowB.end);
    expect(windowB.start).toBeLessThan(windowA.end);
  });
});
