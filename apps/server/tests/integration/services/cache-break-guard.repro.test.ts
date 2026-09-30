/**
 * Prompt-caching plan (BUG-051) T2 — AC-PC-9 and AC-PC-10 through the
 * REAL recorder and DB: classification stored in the new `cache_break` column, warn/info logging. DB-backed
 * (`RUN_DB_TESTS=1`), `*.repro.test.ts` so it stays out of the default testMatch until T4/T5b go green.
 *
 * Interface assumed (T4/T5b implement to it — recorded in the plan § Evidence, T2):
 *  - `llm_calls.cache_break` (nullable text): 'none' | `planned:<reason>` | `unplanned:<where>` | 'unexplained_miss';
 *  - `llm_calls.cache_break_lost_tokens` (nullable int): tokens the break cost (`unplanned:*`,
 *    `unexplained_miss`, planned breaks alike; null for `none`) — the cache report sorts by money from it;
 *  - `RecordLlmCallInput.cacheBreakReasons?: string[]` — the run's declared reasons (D8.1);
 *  - warn `'Prompt cache break'` with `{ userId, where, lostTokens, lostCostUsd }` for `unplanned:*` and
 *    `unexplained_miss` (`where` = 'unexplained_miss' for the latter); `planned:hard_cap` and
 *    `planned:facts_changed` → info with the same message; every other planned break silent.
 *    `lostCostUsd = lostTokens × LLM_INPUT_PRICE_PER_MTOK / 1e6` (list price), null when the price is unset.
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { recordLlmCall, type RecordLlmCallInput } from '@infra/ai/llm-call-recorder';
import { db } from '@infra/db/drizzle';
import { llmCalls } from '@infra/db/schema';

jest.mock('@shared/logger', () => {
  const fns = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => fns, __logFns: fns };
});
const { __logFns: logFns } = jest.requireMock('@shared/logger') as {
  __logFns: { info: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock };
};

const PROMPT = 'You are the training coach. '.repeat(200);
const FACTS = '\n\n## User Facts\n- likes squats';
const MODEL = 'anthropic/claude-sonnet-5.5';

type Msg = { role: string; content: string };
const H0: Msg = { role: 'user', content: 'привет' };
const A0: Msg = { role: 'assistant', content: 'Привет! Начинаем?' };

function call(
  userId: string,
  system: string,
  tail: Msg[],
  extra: Partial<RecordLlmCallInput> & { usage?: Record<string, unknown>; cacheBreakReasons?: string[] } = {},
): RecordLlmCallInput {
  const { usage, ...rest } = extra;
  return {
    runId: randomUUID(),
    userId,
    model: MODEL,
    request: {
      model: MODEL,
      messages: [{ role: 'system', content: system }, H0, A0, ...tail],
      tools: [{ n: 'log_set' }],
    },
    response: {
      text: 'ok',
      finishReason: 'stop',
      usage: { promptTokens: 5000, completionTokens: 10, cacheReadTokens: 4000, ...usage },
    },
    startedAt: Date.now(),
    latencyMs: 100,
    ...rest,
  } as RecordLlmCallInput;
}

const PREV_TAIL: Msg[] = [{ role: 'user', content: '<context>NOW 11:59\nsquat: 0 sets</context>\nжим 60' }];
const NEXT_TAIL: Msg[] = [
  { role: 'user', content: 'жим 60' },
  { role: 'assistant', content: 'Записал' },
  { role: 'user', content: '<context>NOW 12:00\nsquat: 1 set</context>\nещё' },
];

async function lastRow(userId: string) {
  const rows = await db.select().from(llmCalls).where(eq(llmCalls.userId, userId)).orderBy(llmCalls.createdAt);
  return rows[rows.length - 1]! as Record<string, unknown>;
}

async function seedPrevious(userId: string): Promise<void> {
  await recordLlmCall(call(userId, `${PROMPT}${FACTS}`, PREV_TAIL));
}

describe('recorder + DB: cache accounting and the cache-break guard', () => {
  const saved = { ...process.env };
  beforeAll(() => {
    process.env['LLM_CACHE_TTL_SECONDS'] = '300';
    process.env['LLM_INPUT_PRICE_PER_MTOK'] = '3';
  });
  afterAll(() => {
    process.env = saved;
  });
  beforeEach(() => {
    Object.values(logFns).forEach(f => f.mockClear());
  });

  it('AC-PC-9: a prefix change with no declared reason → cache_break unplanned:<where>, warn with lost tokens and cost', async () => {
    const userId = randomUUID();
    await seedPrevious(userId);
    await recordLlmCall(
      call(userId, `${PROMPT}${FACTS}\n- new knee injury`, NEXT_TAIL, { usage: { cacheReadTokens: 0 } }),
    );
    const row = await lastRow(userId);
    expect(row['cacheBreak']).toBe('unplanned:system:facts');
    expect(row['cacheBreakLostTokens']).toBeGreaterThan(0);
    expect(logFns.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        where: 'system:facts',
        lostTokens: expect.any(Number),
        lostCostUsd: expect.any(Number),
      }),
      'Prompt cache break',
    );
  });

  it('AC-PC-9: the same change with its reason declared → planned:<reason>, no warning', async () => {
    const userId = randomUUID();
    await seedPrevious(userId);
    await recordLlmCall(
      call(userId, `${PROMPT}${FACTS}\n- new knee injury`, NEXT_TAIL, {
        usage: { cacheReadTokens: 0 },
        cacheBreakReasons: ['phase_switch', 'facts_changed'],
      }),
    );
    expect((await lastRow(userId))['cacheBreak']).toBe('planned:facts_changed');
    expect(logFns.warn).not.toHaveBeenCalledWith(expect.anything(), 'Prompt cache break');
    // planned but not standard mid-workout → info (optimisation candidate)
    expect(logFns.info).toHaveBeenCalledWith(expect.objectContaining({ userId }), 'Prompt cache break');
  });

  it('AC-PC-9: a change after breakpoint 2 (the current turn) → none, nothing logged', async () => {
    const userId = randomUUID();
    await seedPrevious(userId);
    await recordLlmCall(call(userId, `${PROMPT}${FACTS}`, NEXT_TAIL, { usage: { cacheReadTokens: 4000 } }));
    expect((await lastRow(userId))['cacheBreak']).toBe('none');
    expect(logFns.warn).not.toHaveBeenCalledWith(expect.anything(), 'Prompt cache break');
  });

  it('AC-PC-10: expected warm, provider read 0 → cache_break unexplained_miss, warned', async () => {
    const userId = randomUUID();
    await seedPrevious(userId);
    await recordLlmCall(call(userId, `${PROMPT}${FACTS}`, NEXT_TAIL, { usage: { cacheReadTokens: 0 } }));
    const row = await lastRow(userId);
    expect(row['cacheExpected']).toBe('warm');
    expect(row['cacheBreak']).toBe('unexplained_miss');
    expect(row['cacheBreakLostTokens']).toBeGreaterThan(0);
    expect(logFns.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId, where: 'unexplained_miss', lostTokens: expect.any(Number) }),
      'Prompt cache break',
    );
  });
});
