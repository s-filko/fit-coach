/**
 * Prompt-caching plan (BUG-051) T2 — AC-PC-6 (D5), wiring half: the compact step defers BUDGET compaction
 * while the previous call of the same user is younger than the cache TTL, unless the estimated total
 * exceeds the hard cap; after a gap ≥ TTL it behaves as today. Pure planner interface: see
 * context/__tests__/compaction-deferral.repro.test.ts.
 *
 * Interface assumed: `EpisodeTunables` (compact.node.ts) gains `cacheTtlMs?: number` (from
 * LLM_PROMPT_CACHE_TTL_SECONDS; unset/0 = no deferral) and `hardCapTokens?: number`
 * (LLM_CONTEXT_HARD_CAP_TOKENS); the step derives "warm" from `state.lastUserMessageAt` vs the run clock.
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import type { LlmGateway } from '@domain/ai/ports';
import type { SummaryPort } from '@domain/conversation/ports';
import type { IUserFactsService } from '@domain/user/ports';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import type { ConversationStateType } from '../../state';
import { buildCompactStep, type EpisodeTunables } from '../compact.node';

const NOW = new Date('2026-09-29T11:00:00Z');
const TTL_MS = 300_000;
const SUMMARY = {
  topics: ['squat'],
  decisions: [],
  userState: [],
  trainingFeedback: [],
  openItems: [],
  factOperations: [],
};

function state(lastAgoMs: number): ConversationStateType {
  return {
    phase: 'training',
    activeSessionId: 's1',
    messages: [
      new HumanMessage({ content: 'первый подход', id: 'm0' }),
      new AIMessage({ content: 'Записал', id: 'm0a', tool_calls: [] }),
      new HumanMessage({ content: 'второй подход', id: 'm1' }),
      new AIMessage({ content: 'Записал', id: 'm2', tool_calls: [] }),
      new HumanMessage({ content: 'третий', id: 'm3' }),
    ],
    pendingTransition: null,
    episodeSummaries: [],
    episodeId: 'run-1',
    episodeStartedAt: '2026-09-29T10:00:00Z',
    lastUserMessageAt: new Date(NOW.getTime() - lastAgoMs).toISOString(),
    compactReason: null,
    courseDirective: null,
    courseCheckFailure: null,
    courseExpiryQuestions: [],
  } as ConversationStateType;
}

const CONFIG = {
  configurable: { thread_id: 'u1' },
  context: {
    runId: 'run-2',
    userId: 'u1',
    user: { id: 'u1', languageCode: 'ru', timezone: 'Europe/Berlin' } as never,
    now: NOW,
    client: 'telegram' as const,
    trigger: 'user_message' as const,
    metrics: new RunMetricsCollector('run-2'),
  },
} as never as RunnableConfig;

function makeStep(config: Record<string, unknown>) {
  const insert = jest.fn().mockResolvedValue({ summaryTurnId: 'st-1' });
  const structured = jest.fn().mockResolvedValue(SUMMARY);
  const step = buildCompactStep({
    llmGateway: { chat: jest.fn(), structured } as unknown as LlmGateway,
    summaries: { insert, latestLegacySummary: jest.fn().mockResolvedValue(null) } as unknown as SummaryPort,
    userFacts: {
      getForPrompt: jest.fn().mockResolvedValue([]),
      getConstraints: jest.fn(),
    } as unknown as IUserFactsService,
    config: {
      gapMs: 3 * 3_600_000,
      minTurns: 0,
      minTokens: 0,
      keepTurns: 1,
      ...config,
    } as EpisodeTunables,
    budgetFor: () => 1, // every message overflows the history budget
  });
  return { step, insert };
}

describe('AC-PC-6: the compact step defers budget compaction while the cache is warm (D5)', () => {
  it('AC-PC-6: previous call 1 min ago (< TTL), estimate under the hard cap → nothing compacted, no summary', async () => {
    const { step, insert } = makeStep({ cacheTtlMs: TTL_MS, hardCapTokens: 60_000 });
    const update = await step(state(60_000), CONFIG);
    expect(update).toEqual({});
    expect(insert).not.toHaveBeenCalled();
  });

  it('AC-PC-6: warm but over the hard cap → budget compaction runs as today', async () => {
    const { step, insert } = makeStep({ cacheTtlMs: TTL_MS, hardCapTokens: 1 });
    const update = await step(state(60_000), CONFIG);
    expect(update.messages?.length).toBeGreaterThan(0);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('AC-PC-6: previous call ≥ TTL ago (cache expired), under the cap → budget compaction runs as today', async () => {
    const { step, insert } = makeStep({ cacheTtlMs: TTL_MS, hardCapTokens: 60_000 });
    const update = await step(state(TTL_MS + 1), CONFIG);
    expect(update.messages?.length).toBeGreaterThan(0);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
