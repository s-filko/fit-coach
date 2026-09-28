/**
 * AC-CA-2 (real DB): `conversation_runs.tokens_cached`/`tokens_reasoning` round-trip through
 * `DrizzleConversationRunService` — the unit test (`conversation-run.service.unit.test.ts`) already
 * proves the mapping against a mocked `db.insert`; this proves the actual columns exist and persist
 * the null-vs-number distinction against the real schema this plan's migration adds.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { ConversationRunRecord } from '@domain/conversation/ports';

import { DrizzleConversationRunService } from '@infra/conversation/drizzle-conversation-run.service';
import { db } from '@infra/db/drizzle';
import { conversationRuns } from '@infra/db/schema';

import { createTestUserData } from '../../shared/test-factories';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';

import { BASE_CONVERSATION_RUN_RECORD } from './conversation-run-record.fixture';

async function seedUser(): Promise<string> {
  const user = await new DrizzleUserRepository().create(createTestUserData({ username: `cache_rollup_${Date.now()}` }));
  return user.id;
}

const rowFor = async (runId: string) => {
  const [row] = await db.select().from(conversationRuns).where(eq(conversationRuns.runId, runId));
  return row!;
};

describe('conversation_runs.tokens_cached / tokens_reasoning (AC-CA-2)', () => {
  it('persists non-null sums', async () => {
    const userId = await seedUser();
    const runId = randomUUID();
    const record: ConversationRunRecord = {
      ...BASE_CONVERSATION_RUN_RECORD,
      runId,
      userId,
      phaseIn: 'chat',
      model: 'z-ai/glm-5.3',
      tokensIn: 5765,
      tokensOut: 30,
      tokensCached: 5760,
      tokensReasoning: 30,
      latencyMs: 900,
      outcome: 'ok',
    };
    await new DrizzleConversationRunService().recordRun(record);

    const row = await rowFor(runId);
    expect(row.tokensCached).toBe(5760);
    expect(row.tokensReasoning).toBe(30);
  });

  it('persists null when no call of the run reported cache/reasoning tokens', async () => {
    const userId = await seedUser();
    const runId = randomUUID();
    const record: ConversationRunRecord = {
      ...BASE_CONVERSATION_RUN_RECORD,
      runId,
      userId,
      phaseIn: 'chat',
      model: 'z-ai/glm-5.3',
      tokensIn: 10,
      tokensOut: 2,
      tokensCached: null,
      tokensReasoning: null,
      latencyMs: 100,
      outcome: 'ok',
    };
    await new DrizzleConversationRunService().recordRun(record);

    const row = await rowFor(runId);
    expect(row.tokensCached).toBeNull();
    expect(row.tokensReasoning).toBeNull();
  });
});
