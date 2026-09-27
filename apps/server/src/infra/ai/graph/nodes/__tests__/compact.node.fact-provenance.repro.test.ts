/**
 * REPRODUCTION (RED) — AC-FP-1..4 / BUG-040. Runs only via an explicit
 * --testMatch; promoted into compact.node.unit.test.ts when the fix lands
 * (fact-provenance Task 2), and this file is deleted.
 *
 * BUG-040: the summariser's fact operations are applied verbatim — nothing
 * checks that a fact came from the USER. On 2026-09-27 the coach's own
 * improvised figure ("~70% веса платформы") became the active user fact
 * `2075cb9f` via an `update`, from an episode where the user only asked
 * «почему ты его называешь рычажным». After the fix, a mutating operation is
 * applied only when the episode's USER messages support it: `evidence` (D2)
 * must quote a user line (D5) and every number in the fact text must be
 * user-stated (or, for `update`, already in the old fact text — D4); `confirm`
 * stays exempt (D3).
 *
 * Ops carrying `evidence` are cast `as FactOperation` — the field is not in
 * the type yet (Task 2 adds it to FactOperationSchema).
 *
 * The harness (makeDeps / channelState / ctxConfig / removedIds) is COPIED
 * from compact.node.unit.test.ts — its helpers are not exported. Task 2
 * promotes the cases and drops the copy.
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import type { EpisodeSummaryV4, FactOperation } from '@domain/conversation/episode';
import type { SummaryPort } from '@domain/conversation/ports';
import type { LlmGateway } from '@domain/ai/ports';
import type { IUserFactsService, UserFact } from '@domain/user/ports';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import type { ConversationStateType } from '../../state';
import { buildCompactStep, type EpisodeTunables } from '../compact.node';

const NOW = new Date('2026-09-27T12:00:00Z');
const RUN_ID = 'run-2';
const EPISODE_ID = 'run-1';
const USER_ID = 'u1';

const FIXED_SUMMARY: EpisodeSummaryV4 = {
  topics: ['lever machine discussed'],
  decisions: [],
  userState: [],
  trainingFeedback: [],
  openItems: [],
  factOperations: [],
};

/**
 * The BUG-040-shaped episode: the beyond-tail (removed, summarised) part is
 * one human question + one assistant claim; the tail (m1..m3) stays verbatim.
 */
function episodeState(humanText: string, aiText: string): ConversationStateType {
  return {
    phase: 'chat',
    activeSessionId: null,
    messages: [
      new HumanMessage({ content: humanText, id: 'm0' }),
      new AIMessage({ content: aiText, id: 'm0a', tool_calls: [] }),
      new HumanMessage({ content: 'Составь план на грудь', id: 'm1' }),
      new AIMessage({ content: 'Готовим план', id: 'm2', tool_calls: [] }),
      new HumanMessage({ content: 'Спасибо', id: 'm3' }), // this run's human
    ],
    pendingTransition: null,
    episodeSummaries: [],
    episodeId: EPISODE_ID,
    episodeStartedAt: '2026-09-27T08:00:00Z',
    lastUserMessageAt: new Date(NOW.getTime() - 4 * 3600 * 1000).toISOString(), // gap met
    compactReason: null,
    courseDirective: null,
    courseCheckFailure: null,
    courseExpiryQuestions: [],
  };
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

function makeDeps(overrides: { structured?: () => Promise<EpisodeSummaryV4> } = {}) {
  const insert = jest
    .fn<Promise<{ summaryTurnId: string }>, Parameters<SummaryPort['insert']>[0][]>()
    .mockResolvedValue({ summaryTurnId: 'summary-turn-1' });
  const latestLegacySummary = jest.fn().mockResolvedValue(null);
  const structured = jest
    .fn()
    .mockImplementation(() => (overrides.structured ? overrides.structured() : Promise.resolve(FIXED_SUMMARY)));
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
    config: { gapMs: 3 * 3600 * 1000, minTurns: 0, minTokens: 0, keepTurns: 1 } as EpisodeTunables,
    budgetFor: () => 1_000_000,
  };
  return { deps, rememberFact, confirmFact, supersedeFact, retractFact, getForPrompt };
}

describe('buildCompactStep — fact provenance (BUG-040, AC-FP-1..4)', () => {
  const KNOWN_FACT_ID = '6e14cfe2-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  /** The lever-machine fact as it was BEFORE the bad update — carries no "70". */
  function knownFact(): UserFact {
    return {
      id: KNOWN_FACT_ID,
      userId: USER_ID,
      category: 'equipment',
      fact: 'For plate-loaded lever machines, displayed plate weight excludes the machine own weight',
      factKey: 'for plate-loaded lever machines, displayed plate weight excludes the machine own weight',
      muscleGroup: null,
      confirmations: 3,
      sourceTurnId: null,
      createdAt: new Date('2026-09-01T00:00:00Z'),
      updatedAt: new Date('2026-09-15T00:00:00Z'),
      durability: 'permanent',
      expiresAt: null,
      reviewAfter: null,
      phaseNote: null,
      phaseAt: null,
      onExpiry: null,
      status: 'active',
      archivedAt: null,
      archivedReason: null,
      closedByUserAt: null,
      supersedesId: null,
      context: null,
    };
  }

  // The BUG-040 episode: the user only ASKED; the "~70%" figure is the coach's
  // own improvisation (fact 2075cb9f was born from exactly this shape).
  const HUMAN_LINE = 'Почему ты его называешь рычажным?';
  const AI_LINE = '«130 кг» = блины полностью + ~70% веса платформы, реальная нагрузка выше.';

  it('AC-FP-1: add with NO evidence stores nothing — and the rest of the batch still applies', async () => {
    const { deps, rememberFact, confirmFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            { op: 'add', category: 'equipment', fact: 'Trains at home with dumbbells only', durability: 'long_term' },
            { op: 'confirm', factId: KNOWN_FACT_ID },
          ],
        }),
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState(HUMAN_LINE, AI_LINE), ctxConfig());

    // RED today: the operation is applied verbatim, evidence or not.
    expect(rememberFact).not.toHaveBeenCalled();
    // The valid sibling in the SAME batch is not lost with it (D-E).
    expect(confirmFact).toHaveBeenCalledTimes(1);
  });

  it('AC-FP-1: add whose evidence is quoted from the ASSISTANT line stores nothing', async () => {
    const { deps, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'add',
              category: 'equipment',
              fact: 'On lever machines ~70% of the platform weight adds to the plates',
              durability: 'long_term',
              evidence: '~70% веса платформы, реальная нагрузка выше',
            } as FactOperation,
          ],
        }),
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState(HUMAN_LINE, AI_LINE), ctxConfig());

    // The quote exists in the episode — but only in the ASSISTANT line.
    expect(rememberFact).not.toHaveBeenCalled();
  });

  it('AC-FP-2: update carrying a coach-only figure (~70%) is skipped — supersedeFact not called, the old fact stays', async () => {
    const { deps, supersedeFact, getForPrompt } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'update',
              factId: KNOWN_FACT_ID,
              category: 'equipment',
              fact: 'On the 45° leg press the platform weight (~70% of its mass) simply adds to the plates',
              durability: 'long_term',
              evidence: 'Почему ты его называешь рычажным?', // verbatim from the human line
            } as FactOperation,
          ],
        }),
    });
    getForPrompt.mockResolvedValue([knownFact()]);
    const compact = buildCompactStep(deps);

    await compact(episodeState(HUMAN_LINE, AI_LINE), ctxConfig());

    // The user line is quoted, but the fact's numbers (45, 70) appear in NO user
    // message and not in the old fact text — the BUG-040 2075cb9f write.
    expect(supersedeFact).not.toHaveBeenCalled();
  });

  it('AC-FP-3: retract whose evidence exists only in the AI message is skipped — retractFact not called', async () => {
    const { deps, retractFact, getForPrompt } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'retract',
              factId: KNOWN_FACT_ID,
              reason: 'the coach said the shoulder is fine now',
              evidence: 'плечо полностью здорово, можно жать свободно',
            } as FactOperation,
          ],
        }),
    });
    getForPrompt.mockResolvedValue([knownFact()]);
    const compact = buildCompactStep(deps);

    await compact(
      episodeState(
        'Как мне сейчас тренировать плечи?',
        'Всё в порядке — плечо полностью здорово, можно жать свободно.',
      ),
      ctxConfig(),
    );

    // The coach's "your shoulder is fine now" cannot close a user constraint.
    expect(retractFact).not.toHaveBeenCalled();
  });

  it('AC-FP-4: add with a verbatim user quote and only user-stated numbers is applied (no over-filtering)', async () => {
    const { deps, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'add',
              category: 'physiological_pattern',
              fact: 'Bench press working weight is 100 kg for 5 reps',
              durability: 'long_term',
              evidence: 'жму лёжа 100 кг на 5 повторов',
            } as FactOperation,
          ],
        }),
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState('Я жму лёжа 100 кг на 5 повторов', 'Отличный прогресс!'), ctxConfig());

    expect(rememberFact).toHaveBeenCalledTimes(1);
    expect(rememberFact.mock.calls[0][1]).toMatchObject({
      fact: 'Bench press working weight is 100 kg for 5 reps',
    });
  });

  it('AC-FP-4: confirm is applied without evidence (D3 — it never changes text)', async () => {
    const { deps, confirmFact, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({ ...FIXED_SUMMARY, factOperations: [{ op: 'confirm', factId: KNOWN_FACT_ID }] }),
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState(HUMAN_LINE, AI_LINE), ctxConfig());

    expect(confirmFact).toHaveBeenCalledTimes(1);
    expect(rememberFact).not.toHaveBeenCalled();
  });
});
