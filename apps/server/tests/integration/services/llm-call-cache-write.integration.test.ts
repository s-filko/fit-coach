/**
 * Prompt-caching plan (BUG-051) T4 — AC-PC-7 (D7) through the REAL recorder and DB: `llm_calls.cache_write_tokens`
 * (nullable int, migration 0021) is stored from `RecordLlmCallResponse.usage.cacheWriteTokens`; 0 is a value,
 * unreported stays null. DB-backed (`RUN_DB_TESTS=1`).
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { recordLlmCall } from '@infra/ai/llm-call-recorder';
import { db } from '@infra/db/drizzle';
import { llmCalls } from '@infra/db/schema';

const MODEL = 'anthropic/claude-sonnet-5.5';

async function record(userId: string, usage: Record<string, unknown>): Promise<void> {
  await recordLlmCall({
    runId: randomUUID(),
    userId,
    model: MODEL,
    request: { model: MODEL, messages: [{ role: 'system', content: 'You are the coach.' }] },
    response: { text: 'ok', finishReason: 'stop', usage: { promptTokens: 5000, completionTokens: 10, ...usage } },
    startedAt: Date.now(),
    latencyMs: 100,
  });
}

async function storedWrite(userId: string): Promise<number | null> {
  const [row] = await db.select().from(llmCalls).where(eq(llmCalls.userId, userId));
  return row!.cacheWriteTokens;
}

describe('llm_calls.cache_write_tokens (AC-PC-7)', () => {
  it('AC-PC-7: stored from the provider usage', async () => {
    const userId = randomUUID();
    await record(userId, { cacheReadTokens: 4000, cacheWriteTokens: 110 });
    expect(await storedWrite(userId)).toBe(110);
  });

  it('AC-PC-7: 0 written is stored as 0', async () => {
    const userId = randomUUID();
    await record(userId, { cacheWriteTokens: 0 });
    expect(await storedWrite(userId)).toBe(0);
  });

  it('AC-PC-7: unreported stays null', async () => {
    const userId = randomUUID();
    await record(userId, {});
    expect(await storedWrite(userId)).toBeNull();
  });
});
