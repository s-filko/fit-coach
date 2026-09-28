/**
 * Fact verification — RED repro tests (fact-verification plan Task 1, BUG-040
 * follow-up, AC-FV-1..4). Run explicitly with `npx jest --testMatch` matching
 * the file-name pattern `*fact-verification*.repro.test.ts` (see plan Task 1).
 * Promoted into compact.node.unit.test.ts (names keep the AC-FV-* prefixes)
 * and deleted in Task 2, when the verifier replaces checkFactProvenance.
 *
 * The gateway stub answers by schemaName: 'episode_summary_v4' (the
 * summariser) → the summary; anything else (the verifier Task 2 adds) → the
 * verdicts `{ verdicts: [{ index, supported, reason }] }` — the type does not
 * exist yet, so it is passed through untyped. On unchanged production the
 * verifier is never called: AC-FV-1..3 fail on the STRING check's behaviour
 * (the digit-only number rule drops real facts, paraphrases/absent quotes
 * pass coach claims), AC-FV-4 already holds and guards against an
 * unconditional verifier call.
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import type { EpisodeSummaryV4, StoredEpisodeSummary } from '@domain/conversation/episode';
import type { SummaryPort } from '@domain/conversation/ports';
import type { LlmGateway } from '@domain/ai/ports';
import type { IUserFactsService } from '@domain/user/ports';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import type { ConversationStateType } from '../../state';
import { buildCompactStep, type EpisodeTunables } from '../compact.node';

const NOW = new Date('2026-09-18T12:00:00Z');
const RUN_ID = 'run-2';
const EPISODE_ID = 'run-1';
const USER_ID = 'u1';
const KNOWN_FACT_ID = '6e14cfe2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const FIXED_SUMMARY = {
  topics: ['plan discussed'],
  decisions: ['upper/lower split'],
  userState: ['mild shoulder discomfort'],
  trainingFeedback: [],
  openItems: ['day 2 not logged'],
  factOperations: [],
};

/** Run 1's traffic + run 2's human message — same shape as the unit test. */
function channelState(overrides: Partial<ConversationStateType> = {}): ConversationStateType {
  return {
    phase: 'chat',
    activeSessionId: null,
    messages: [
      new HumanMessage({ content: 'Что делаем сегодня?', id: 'm0' }),
      new AIMessage({ content: 'Продолжаем план на грудь', id: 'm0a', tool_calls: [] }),
      new HumanMessage({ content: 'Составь план на грудь', id: 'm1' }),
      new AIMessage({ content: 'Готовим план', id: 'm2', tool_calls: [] }),
      new HumanMessage({ content: 'Спасибо', id: 'm3' }), // this run's human
    ],
    pendingTransition: null,
    episodeSummaries: [] as StoredEpisodeSummary[],
    episodeId: EPISODE_ID,
    episodeStartedAt: '2026-09-18T08:00:00Z',
    lastUserMessageAt: new Date(NOW.getTime() - 4 * 3600 * 1000).toISOString(), // gap met
    compactReason: null,
    courseDirective: null,
    courseCheckFailure: null,
    courseExpiryQuestions: [],
    ...overrides,
  };
}

/** The compacted (removed) episode: one human + one assistant line. */
function episodeState(humanText: string, aiText: string): ConversationStateType {
  return channelState({
    messages: [
      new HumanMessage({ content: humanText, id: 'm0' }),
      new AIMessage({ content: aiText, id: 'm0a', tool_calls: [] }),
      new HumanMessage({ content: 'Составь план на грудь', id: 'm1' }),
      new AIMessage({ content: 'Готовим план', id: 'm2', tool_calls: [] }),
      new HumanMessage({ content: 'Спасибо', id: 'm3' }), // this run's human
    ],
  });
}

function ctxConfig(now = NOW): RunnableConfig {
  return {
    configurable: { thread_id: USER_ID },
    context: {
      runId: RUN_ID,
      userId: USER_ID,
      user: { id: USER_ID, languageCode: 'ru', timezone: 'Europe/Berlin' } as never,
      now,
      client: 'telegram' as const,
      trigger: 'user_message' as const,
      metrics: new RunMetricsCollector(RUN_ID),
    },
  } as never;
}

/**
 * The schemaName-dispatching gateway: the summariser ('episode_summary_v4')
 * gets `summary`; a verifier call (any other schemaName — Task 2 will use
 * 'fact_verdicts_v1') gets `verdicts`, or rejects when `verifierRejects`.
 */
function makeDeps(overrides: {
  summary: EpisodeSummaryV4;
  verdicts?: unknown;
  verifierRejects?: boolean;
  config?: Partial<EpisodeTunables>;
}) {
  const insert = jest
    .fn<Promise<{ summaryTurnId: string }>, Parameters<SummaryPort['insert']>[0][]>()
    .mockResolvedValue({ summaryTurnId: 'summary-turn-1' });
  const latestLegacySummary = jest.fn().mockResolvedValue(null);
  const structured = jest
    .fn()
    .mockImplementation((_schema: unknown, _messages: unknown, opts: { schemaName?: string }) => {
      if (opts?.schemaName === 'episode_summary_v4') {
        return Promise.resolve(overrides.summary);
      }
      if (overrides.verifierRejects) {
        return Promise.reject(new Error('verifier down'));
      }
      return Promise.resolve(overrides.verdicts);
    });
  const rememberFact = jest.fn().mockResolvedValue({ outcome: 'created', fact: null as never });
  const confirmFact = jest.fn().mockResolvedValue(true);
  const supersedeFact = jest.fn().mockResolvedValue({ outcome: 'created', fact: null as never });
  const retractFact = jest.fn().mockResolvedValue(null);
  const getForPrompt = jest.fn().mockResolvedValue([]);
  const deps = {
    llmGateway: { chat: jest.fn(), structured } as unknown as LlmGateway,
    summaries: { insert, latestLegacySummary } as unknown as SummaryPort,
    userFacts: {
      rememberFact,
      confirmFact,
      supersedeFact,
      retractFact,
      getForPrompt,
      getConstraints: jest.fn(),
    } as unknown as IUserFactsService,
    config: { gapMs: 3 * 3600 * 1000, minTurns: 0, minTokens: 0, keepTurns: 1, ...overrides.config },
    budgetFor: () => 1_000_000,
  };
  return { deps, insert, structured, rememberFact, confirmFact, supersedeFact, retractFact };
}

function removedIds(update: Partial<ConversationStateType>): string[] {
  const messages = (update.messages ?? []) as unknown as Array<{ id?: string; remove?: boolean }>;
  return messages.map(m => m.id ?? '');
}

describe('buildCompactStep — fact verification (BUG-040 follow-up, AC-FV-1..4)', () => {
  it('AC-FV-1: a number stated in words by the user («пять дней») is stored when the verifier supports it', async () => {
    const { deps, rememberFact } = makeDeps({
      summary: {
        ...FIXED_SUMMARY,
        factOperations: [
          {
            op: 'add',
            category: 'physical_constraint',
            fact: 'Knee pain for 5 days',
            durability: 'long_term',
            evidence: 'колено болит уже пять дней',
          },
        ],
      } as EpisodeSummaryV4,
      verdicts: { verdicts: [{ index: 0, supported: true, reason: 'the user said «пять дней» — five days' }] },
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState('Колено болит уже пять дней', 'Понял, скорректирую нагрузку на ноги.'), ctxConfig());

    expect(rememberFact).toHaveBeenCalledTimes(1);
    expect(rememberFact.mock.calls[0][1]).toMatchObject({ fact: 'Knee pain for 5 days' });
  });

  it('AC-FV-2: a verdict-unsupported coach claim is skipped; a supported sibling in the batch applies', async () => {
    const { deps, rememberFact } = makeDeps({
      summary: {
        ...FIXED_SUMMARY,
        factOperations: [
          {
            op: 'add',
            category: 'equipment',
            fact: 'The leg press is a lever machine',
            durability: 'long_term',
            evidence: 'где тут рычаг',
          },
          {
            op: 'add',
            category: 'equipment',
            fact: 'Wants to understand how the machines work',
            durability: 'short',
            ttlDays: 30,
            evidence: 'А где тут рычаг?',
          },
        ],
      } as EpisodeSummaryV4,
      verdicts: {
        verdicts: [
          { index: 0, supported: false, reason: 'only the assistant called it a lever machine' },
          { index: 1, supported: true, reason: 'the user asked exactly that' },
        ],
      },
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState('А где тут рычаг?', 'Это рычажный тренажёр, рычаг даёт выигрыш в силе.'), ctxConfig());

    expect(rememberFact).toHaveBeenCalledTimes(1);
    expect(rememberFact.mock.calls[0][1]).toMatchObject({ fact: 'Wants to understand how the machines work' });
  });

  it('AC-FV-3: verifier failure → no mutating operation applied; confirm and the summary still apply', async () => {
    const { deps, insert, rememberFact, confirmFact, supersedeFact, retractFact } = makeDeps({
      summary: {
        ...FIXED_SUMMARY,
        factOperations: [
          {
            op: 'add',
            category: 'physical_constraint',
            fact: 'Knee is painful',
            durability: 'long_term',
            evidence: 'Колено болит',
          },
          { op: 'confirm', factId: KNOWN_FACT_ID },
        ],
      } as EpisodeSummaryV4,
      verifierRejects: true,
    });
    const compact = buildCompactStep(deps);

    const update = await compact(episodeState('Колено болит', 'Скорректирую нагрузку.'), ctxConfig());

    expect(rememberFact).not.toHaveBeenCalled();
    expect(supersedeFact).not.toHaveBeenCalled();
    expect(retractFact).not.toHaveBeenCalled();
    expect(confirmFact).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(removedIds(update)).toEqual(['m0', 'm0a']); // compaction result unchanged
  });

  it('AC-FV-4: a confirm-only summary makes exactly ONE structured call — the summariser', async () => {
    const { deps, structured, confirmFact } = makeDeps({
      summary: { ...FIXED_SUMMARY, factOperations: [{ op: 'confirm', factId: KNOWN_FACT_ID }] } as EpisodeSummaryV4,
      verdicts: { verdicts: [] }, // if the verifier were wrongly called, it would void nothing here
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState('Колено болит', 'Скорректирую нагрузку.'), ctxConfig());

    expect(structured).toHaveBeenCalledTimes(1);
    expect(confirmFact).toHaveBeenCalledTimes(1);
  });

  it('AC-FV-4: a verdict list missing index 1 → operation 1 unsupported and not applied', async () => {
    const { deps, rememberFact } = makeDeps({
      summary: {
        ...FIXED_SUMMARY,
        factOperations: [
          {
            op: 'add',
            category: 'equipment',
            fact: 'Trains with dumbbells',
            durability: 'short',
            ttlDays: 30,
            evidence: 'Я тренируюсь с гантелями',
          },
          {
            op: 'add',
            category: 'equipment',
            fact: 'The coach recommends progressive overload',
            durability: 'long_term',
            evidence: 'рекомендую прогрессию нагрузки',
          },
        ],
      } as EpisodeSummaryV4,
      verdicts: { verdicts: [{ index: 0, supported: true, reason: 'the user said it' }] }, // index 1 missing
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState('Я тренируюсь с гантелями', 'Рекомендую прогрессию нагрузки.'), ctxConfig());

    expect(rememberFact).toHaveBeenCalledTimes(1);
    expect(rememberFact.mock.calls[0][1]).toMatchObject({ fact: 'Trains with dumbbells' });
  });
});
