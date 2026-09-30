/**
 * The compact step (BR-LLM-001..004, D-E; refactor-p4-episode-memory Task 6):
 * synchronous, inside prepare, at most once per run. Summariser failure
 * degrades to trimming without a summary; the summary port is best-effort;
 * the legacy rolling summary is imported exactly once for live threads.
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import type { EpisodeSummaryV4, StoredEpisodeSummary } from '@domain/conversation/episode';
import type { SummaryPort } from '@domain/conversation/ports';
import type { LlmGateway } from '@domain/ai/ports';
import type { IUserFactsService, UserFact } from '@domain/user/ports';
import { PermanentFactRefusal } from '@domain/user/services/fact-lifecycle';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import type { ConversationStateType } from '../../state';
import { buildCompactStep, type EpisodeTunables } from '../compact.node';

const NOW = new Date('2026-09-18T12:00:00Z');
const RUN_ID = 'run-2';
const EPISODE_ID = 'run-1';
const USER_ID = 'u1';

const FIXED_SUMMARY = {
  topics: ['plan discussed'],
  decisions: ['upper/lower split'],
  userState: ['mild shoulder discomfort'],
  trainingFeedback: [],
  openItems: ['day 2 not logged'],
  factOperations: [],
};

/** Run 1's traffic (with ids — RemoveMessage needs them) + run 2's human message. */
function channelState(overrides: Partial<ConversationStateType> = {}): ConversationStateType {
  return {
    phase: 'chat',
    activeSessionId: null,
    messages: [
      // Two prior turns; with the default keepTurns 1 the first turn is the
      // beyond-tail part and the second stays verbatim (AC-CC-1).
      new HumanMessage({ content: 'Что делаем сегодня?', id: 'm0' }),
      new AIMessage({ content: 'Продолжаем план на грудь', id: 'm0a', tool_calls: [] }),
      new HumanMessage({ content: 'Составь план на грудь', id: 'm1' }),
      new AIMessage({ content: 'Готовим план', id: 'm2', tool_calls: [] }),
      new HumanMessage({ content: 'Спасибо', id: 'm3' }), // this run's human
    ],
    pendingTransition: null,
    episodeSummaries: [],
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

function makeDeps(
  overrides: {
    config?: Partial<EpisodeTunables>;
    structured?: () => Promise<EpisodeSummaryV4>;
    /** The verifier's answer for the fact_verdicts_v1 call; default = every mutating op supported. */
    verdicts?: unknown;
    /** D5's failure mode: the verifier call rejects (fail closed). */
    verifierRejects?: boolean;
    upsertMany?: () => Promise<number>;
  } = {},
) {
  const insert = jest
    .fn<Promise<{ summaryTurnId: string }>, Parameters<SummaryPort['insert']>[0][]>()
    .mockResolvedValue({ summaryTurnId: 'summary-turn-1' });
  const latestLegacySummary = jest.fn().mockResolvedValue(null);
  // The schemaName dispatch the production code now does: the summariser
  // ('episode_summary_v4') gets the summary, the verifier
  // ('fact_verdicts_v1', fact-verification plan Task 2) gets verdicts — by
  // default every MUTATING op supported, in the verifier's own numbering
  // (mutating ops only, 0-based, in batch order).
  let lastMutating: Array<{ op: string }> = [];
  const structured = jest
    .fn()
    .mockImplementation((_schema: unknown, _messages: unknown, opts: { schemaName?: string }) => {
      if (opts?.schemaName !== 'episode_summary_v4') {
        if (overrides.verifierRejects) {
          return Promise.reject(new Error('verifier down'));
        }
        return Promise.resolve(
          overrides.verdicts ?? {
            verdicts: lastMutating.map((_, i) => ({ index: i, supported: true, reason: 'stub: supported' })),
          },
        );
      }
      return overrides.structured
        ? overrides.structured().then(resolved => {
            lastMutating = (resolved.factOperations ?? []).filter(op => op.op !== 'confirm');
            return resolved;
          })
        : Promise.resolve(FIXED_SUMMARY);
    });
  const upsertMany = jest
    .fn()
    .mockImplementation(() => (overrides.upsertMany ? overrides.upsertMany() : Promise.resolve(0)));
  // The fact-operations port (fact-lifecycle Task 3): every method recorded so
  // the application tests can pin args (both clocks!) and call counts.
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
  return {
    deps,
    insert,
    latestLegacySummary,
    structured,
    rememberFact,
    confirmFact,
    supersedeFact,
    retractFact,
    getForPrompt,
  };
}

function removedIds(update: Partial<ConversationStateType>): string[] {
  const messages = (update.messages ?? []) as unknown as Array<{ id?: string; remove?: boolean }>;
  return messages.map(m => m.id ?? '');
}

describe('buildCompactStep (BR-LLM-001..004)', () => {
  it('BR-LLM-001: inactivity — summary stored, messages removed by id, episodeSummaries max 3 oldest first', async () => {
    const existing: StoredEpisodeSummary[] = [
      { episodeId: 'e1', phaseAtEnd: 'chat', endedAt: '2026-09-10T10:00:00Z', summary: FIXED_SUMMARY },
      { episodeId: 'e2', phaseAtEnd: 'chat', endedAt: '2026-09-12T10:00:00Z', summary: FIXED_SUMMARY },
      { episodeId: 'e3', phaseAtEnd: 'training', endedAt: '2026-09-14T10:00:00Z', summary: FIXED_SUMMARY },
    ];
    const { deps, insert } = makeDeps();
    const compact = buildCompactStep(deps);

    const update = await compact(channelState({ episodeSummaries: existing }), ctxConfig());

    expect(removedIds(update)).toEqual(['m0', 'm0a']);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({
      userId: USER_ID,
      runId: RUN_ID,
      episodeId: EPISODE_ID,
      phaseAtEnd: 'chat',
    });
    expect(update.episodeSummaries).toHaveLength(3); // max 3, oldest dropped
    expect(update.episodeSummaries?.map(s => s.episodeId)).toEqual(['e2', 'e3', EPISODE_ID]);
    expect(update.episodeId).toBe(RUN_ID); // D-O: the new episode starts with this run
    expect(update.episodeStartedAt).toBe(NOW.toISOString());
    expect(update.compactReason).toBeNull();
  });

  it('BR-LLM-004: summariser failure → no summary, messages still removed', async () => {
    const { deps, insert, structured, rememberFact } = makeDeps({
      structured: () => Promise.reject(new Error('provider down')),
    });
    const compact = buildCompactStep(deps);

    const update = await compact(channelState(), ctxConfig());

    expect(structured).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
    // A failed summariser writes no facts (there is no `summary` to read operations from).
    expect(rememberFact).not.toHaveBeenCalled();
    expect(removedIds(update)).toEqual(['m0', 'm0a']);
    expect(update.episodeSummaries).toBeUndefined();
  });

  it('summary insert failure is logged, not thrown (best-effort)', async () => {
    const { deps, insert } = makeDeps();
    insert.mockRejectedValue(new Error('db down'));
    const compact = buildCompactStep(deps);

    const update = await compact(channelState(), ctxConfig());

    expect(insert).toHaveBeenCalledTimes(1);
    expect(removedIds(update)).toEqual(['m0', 'm0a']); // trimming happened regardless
  });

  // fact-lifecycle plan Task 1: source_turn_id is filled at extraction — a fact is
  // born out of the summarisation, so the mirrored summary turn is its provenance
  // (coordinator decision 2026-09-21). Task 3: the write is now an OPERATION.
  it('passes the summary turn id as sourceTurnId to an add operation', async () => {
    const { deps, insert, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'add',
              category: 'equipment',
              fact: 'Has a barbell',
              durability: 'short',
              ttlDays: 5,
              evidence: 'Что делаем сегодня?',
            },
          ],
        }),
    });
    insert.mockResolvedValue({ summaryTurnId: 'summary-turn-1' });
    const compact = buildCompactStep(deps);

    await compact(channelState(), ctxConfig());

    expect(rememberFact).toHaveBeenCalledTimes(1);
    expect(rememberFact.mock.calls[0][3]).toBe('summary-turn-1');
  });

  // D-E stays intact: fact writing is independent of the summary insert.
  it('a failed summary insert still applies the operations — with sourceTurnId left undefined', async () => {
    const { deps, insert, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'add',
              category: 'equipment',
              fact: 'Has a barbell',
              durability: 'short',
              ttlDays: 5,
              evidence: 'Что делаем сегодня?',
            },
          ],
        }),
    });
    insert.mockRejectedValue(new Error('db down'));
    const compact = buildCompactStep(deps);

    await compact(channelState(), ctxConfig());

    expect(rememberFact).toHaveBeenCalledTimes(1);
    expect(rememberFact.mock.calls[0][3]).toBeUndefined();
  });

  it('AC-CC-1: a too-short beyond-tail part is KEPT — no model call, nothing removed, no rotation', async () => {
    const { deps, insert, structured } = makeDeps({ config: { minTurns: 5 } });
    const compact = buildCompactStep(deps);

    const update = await compact(channelState(), ctxConfig());

    expect(structured).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    // Supersedes D-B's trim-without-summary: the one-turn older part rides
    // along verbatim until a later compaction can summarise it.
    expect(update.messages).toBeUndefined();
    expect(update.episodeId).toBeUndefined();
    expect(update.episodeStartedAt).toBeUndefined();
    expect(update.compactReason).toBeNull(); // the flag is still consumed
  });

  it('AC-CC-1: history within keepTurns turns → compaction deferred entirely', async () => {
    const { deps, insert, structured } = makeDeps({ config: { keepTurns: 5 } });
    const compact = buildCompactStep(deps);

    const update = await compact(channelState(), ctxConfig());

    expect(structured).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(update.messages).toBeUndefined();
    expect(update.compactReason).toBeNull();
  });

  it('AC-CC-1: the summariser sees only the beyond-tail part — the tail stays out of the transcript', async () => {
    const { deps, structured } = makeDeps();
    const compact = buildCompactStep(deps);

    await compact(channelState(), ctxConfig());

    const calls = structured.mock.calls as unknown as [unknown, Array<{ role: string; content: string }>][];
    const transcript = calls[0][1].find(m => m.role === 'user')!.content;
    expect(transcript).toContain('Что делаем сегодня?');
    expect(transcript).not.toContain('Составь план на грудь');
  });

  it('BR-LLM-002: phase_boundary (state.compactReason) is consumed exactly once', async () => {
    const { deps } = makeDeps({ config: { gapMs: 24 * 3600 * 1000 } });
    const compact = buildCompactStep(deps);

    const update = await compact(
      channelState({
        compactReason: 'phase_boundary',
        lastUserMessageAt: new Date(NOW.getTime() - 60_000).toISOString(),
      }),
      ctxConfig(),
    );

    expect(update.compactReason).toBeNull();
    expect(removedIds(update)).toEqual(['m0', 'm0a']);
  });

  it('no trigger → {} (nothing touched)', async () => {
    const { deps, insert, latestLegacySummary } = makeDeps({ config: { gapMs: 24 * 3600 * 1000 } });
    const compact = buildCompactStep(deps);

    const update = await compact(
      channelState({ lastUserMessageAt: new Date(NOW.getTime() - 60_000).toISOString() }),
      ctxConfig(),
    );

    expect(update).toEqual({});
    expect(latestLegacySummary).not.toHaveBeenCalled();
  });

  it('BR-LLM-003: budget overflow compacts the oldest turns only', async () => {
    const { deps } = makeDeps();
    (deps as { budgetFor: () => number }).budgetFor = () => 1; // every message overflows
    const compact = buildCompactStep(deps);

    const update = await compact(
      channelState({ lastUserMessageAt: new Date(NOW.getTime() - 60_000).toISOString() }),
      ctxConfig(),
    );

    // Budget 1: even the keepTurns-1 tail alone overflows — everything goes, oldest first.
    expect(removedIds(update)).toEqual(['m0', 'm0a', 'm1', 'm2']);
  });

  /**
   * AC-SI-5a (session-investigation-0925, BUG-038 part 1): config.budgetLowWater
   * (EPISODE_BUDGET_LOW_WATER) must reach planCompaction's lowWaterMark — a
   * budget cut with headroom removes MORE than a just-fits cut over the same
   * history. 4 turns of 24 estimated tokens each (96 total); budgetFor = 73
   * triggers 'budget' (96 > 73). Just-fits (budgetLowWater omitted) removes
   * only the oldest turn (72 <= 73); with budgetLowWater 0.5 (target 36.5) it
   * removes the oldest 3 turns (24 <= 36.5).
   */
  it('AC-SI-5a: config.budgetLowWater threads into the budget cut — more headroom removes more', async () => {
    function budgetTurn(i: number): [HumanMessage, AIMessage] {
      return [
        new HumanMessage({ id: `bh${i}`, content: 'x'.repeat(40) }),
        new AIMessage({ id: `ba${i}`, content: 'y'.repeat(40), tool_calls: [] }),
      ];
    }
    const budgetHistoryState = channelState({
      messages: [
        ...budgetTurn(0),
        ...budgetTurn(1),
        ...budgetTurn(2),
        ...budgetTurn(3),
        new HumanMessage({ content: 'сейчас', id: 'cur' }),
      ],
      lastUserMessageAt: null,
    });

    const { deps: justFitsDeps } = makeDeps();
    (justFitsDeps as { budgetFor: () => number }).budgetFor = () => 73;
    const justFitsUpdate = await buildCompactStep(justFitsDeps)(budgetHistoryState, ctxConfig());

    const { deps: lowWaterDeps } = makeDeps({ config: { budgetLowWater: 0.5 } });
    (lowWaterDeps as { budgetFor: () => number }).budgetFor = () => 73;
    const lowWaterUpdate = await buildCompactStep(lowWaterDeps)(budgetHistoryState, ctxConfig());

    expect(removedIds(justFitsUpdate)).toEqual(['bh0', 'ba0']);
    expect(removedIds(lowWaterUpdate)).toEqual(['bh0', 'ba0', 'bh1', 'ba1', 'bh2', 'ba2']);
  });

  // Close-out review fix (ADR-0013 §3.3 amendment, 2026-09-20): at ANY
  // trigger a too-short part is never dropped — a budget cut is ALWAYS
  // summarised, so one huge oldest turn (D-B "short" by turns) or a tiny
  // removed part can no longer leave the channel unsummarised (BUG-018).
  it('AC-CC-1: a budget-cut part is always summarised — a single long oldest turn is not dropped unsummarised', async () => {
    const { deps, insert, structured } = makeDeps({ config: { minTurns: 5 } }); // removed is "short" by D-B's turns
    (deps as { budgetFor: () => number }).budgetFor = () => 1; // every message overflows
    const compact = buildCompactStep(deps);

    const update = await compact(
      channelState({ lastUserMessageAt: new Date(NOW.getTime() - 60_000).toISOString() }),
      ctxConfig(),
    );

    expect(structured).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(removedIds(update)).toEqual(['m0', 'm0a', 'm1', 'm2']);
  });

  it('AC-CC-1: a tiny budget-cut part is still summarised (no D-B trim on the budget trigger)', async () => {
    const { deps, insert, structured } = makeDeps({ config: { minTokens: 500_000 } }); // "short" by D-B's tokens
    (deps as { budgetFor: () => number }).budgetFor = () => 1;
    const compact = buildCompactStep(deps);

    const update = await compact(
      channelState({ lastUserMessageAt: new Date(NOW.getTime() - 60_000).toISOString() }),
      ctxConfig(),
    );

    expect(structured).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(removedIds(update)).toEqual(['m0', 'm0a', 'm1', 'm2']);
  });

  it('the summariser call goes through the gateway with the summarizer profile and schema name', async () => {
    const { deps, structured } = makeDeps();
    const compact = buildCompactStep(deps);

    await compact(channelState(), ctxConfig());

    const [schema, messages, opts] = structured.mock.calls[0] as unknown as [
      unknown,
      Array<{ role: string }>,
      Record<string, string>,
    ];
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(opts).toMatchObject({
      profile: 'summarizer',
      schemaName: 'episode_summary_v4',
      runId: RUN_ID,
      userId: USER_ID,
    });
    void schema;
  });
});

describe('buildCompactStep — fact operations (fact-lifecycle Task 3, AC-FL-4)', () => {
  const KNOWN_FACT_ID = '5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  function knownFact(): UserFact {
    return {
      id: KNOWN_FACT_ID,
      userId: USER_ID,
      category: 'physical_constraint',
      fact: 'Cannot overhead press, shoulder injury',
      factKey: 'cannot overhead press, shoulder injury',
      muscleGroup: 'shoulders_front',
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
      evidence: null,
    };
  }

  it('the KNOWN active facts reach the summariser prompt (AC-FL-4: it sees what it is operating on)', async () => {
    const { deps, getForPrompt, structured } = makeDeps();
    getForPrompt.mockResolvedValue([knownFact()]);
    const compact = buildCompactStep(deps);

    await compact(channelState(), ctxConfig());

    expect(getForPrompt).toHaveBeenCalledWith(USER_ID, NOW);
    const calls = structured.mock.calls as unknown as [unknown, Array<{ role: string; content: string }>][];
    const prompt = calls[0][1].find(m => m.role === 'user')!.content;
    expect(prompt).toContain(KNOWN_FACT_ID);
    expect(prompt).toContain('Cannot overhead press, shoulder injury');
  });

  it('add: rememberFact gets the EPISODE clock as evidenceAt and the RUN clock as now — never ctx.now for both', async () => {
    // AC-FL-3's two-clock pin: the episode's newest user message (T_EPI) is
    // hours older than the run (NOW). Passing NOW as the evidence would let an
    // old restatement re-open a fact the user closed in between.
    const T_EPI = new Date(NOW.getTime() - 4 * 3600 * 1000);
    const { deps, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'add',
              category: 'physical_constraint',
              fact: 'Broken wrist',
              muscleGroup: 'shoulders_front',
              durability: 'long_term',
              reviewInDays: 60,
              phaseNote: 'in a cast',
              evidence: 'Что делаем сегодня?',
            },
          ],
        }),
    });
    const compact = buildCompactStep(deps);

    await compact(channelState({ lastUserMessageAt: T_EPI.toISOString() }), ctxConfig());

    expect(rememberFact).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        category: 'physical_constraint',
        fact: 'Broken wrist',
        durability: 'long_term',
        reviewInDays: 60,
        phaseNote: 'in a cast',
        evidenceAt: T_EPI, // the EPISODE clock — not NOW
      }),
      NOW, // the run clock — every written date
      'summary-turn-1',
    );
  });

  it('add without a known lastUserMessageAt falls back to the run clock (no episode timestamp available)', async () => {
    const { deps, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'add',
              category: 'equipment',
              fact: 'Has a barbell',
              durability: 'short',
              ttlDays: 5,
              evidence: 'Что делаем сегодня?',
            },
          ],
        }),
    });
    const compact = buildCompactStep(deps);

    // phase_boundary forces compaction without the inactivity gap (which needs
    // lastUserMessageAt to measure) — the exact no-episode-timestamp case.
    await compact(channelState({ lastUserMessageAt: null, compactReason: 'phase_boundary' }), ctxConfig());

    expect(rememberFact.mock.calls[0][1].evidenceAt).toEqual(NOW);
  });

  it('add: explicitPermanent flows through — an irreversible condition stated in the episode stores permanent', async () => {
    const { deps, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'add',
              category: 'physical_constraint',
              fact: 'Amputated left leg',
              durability: 'permanent',
              explicitPermanent: true,
              evidence: 'Что делаем сегодня?',
            },
          ],
        }),
    });
    const compact = buildCompactStep(deps);

    await compact(channelState(), ctxConfig());

    expect(rememberFact).toHaveBeenCalledTimes(1);
    expect(rememberFact.mock.calls[0][1]).toMatchObject({ durability: 'permanent', explicitPermanent: true });
  });

  it('add: permanent WITHOUT the flag is not LOST — retried as long_term with a review note (close-out finding 2)', async () => {
    const { deps, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'add',
              category: 'physical_constraint',
              fact: 'Bad back forever',
              durability: 'permanent',
              evidence: 'Что делаем сегодня?',
            },
          ],
        }),
    });
    rememberFact.mockRejectedValueOnce(new PermanentFactRefusal());
    const compact = buildCompactStep(deps);

    await compact(channelState(), ctxConfig());

    expect(rememberFact).toHaveBeenCalledTimes(2);
    expect(rememberFact.mock.calls[1]?.[1]).toMatchObject({
      durability: 'long_term',
      reviewInDays: undefined, // the class-minimum review date is the default
    });
    expect(String(rememberFact.mock.calls[1]?.[1]?.context)).toContain('permanence was not established');
  });

  it('update: supersedeFact gets explicitPermanent too — and the same non-lossy downgrade', async () => {
    const { deps, supersedeFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'update',
              factId: KNOWN_FACT_ID,
              category: 'physical_constraint',
              fact: 'Chronic, irreversible disc condition',
              durability: 'permanent',
              explicitPermanent: true,
              evidence: 'Что делаем сегодня?',
            },
          ],
        }),
    });
    const compact = buildCompactStep(deps);

    await compact(channelState(), ctxConfig());

    expect(supersedeFact).toHaveBeenCalledTimes(1);
    expect(supersedeFact.mock.calls[0][1]).toMatchObject({ durability: 'permanent', explicitPermanent: true });
  });

  it('confirm: bumps the counter without touching the text — confirmFact with the run clock', async () => {
    const { deps, confirmFact, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({ ...FIXED_SUMMARY, factOperations: [{ op: 'confirm', factId: KNOWN_FACT_ID }] }),
    });
    const compact = buildCompactStep(deps);

    await compact(channelState(), ctxConfig());

    expect(confirmFact).toHaveBeenCalledWith(USER_ID, KNOWN_FACT_ID, NOW);
    expect(rememberFact).not.toHaveBeenCalled(); // D-C: a confirm never rewrites
  });

  it('update: supersedes with a link — supersedeFact carries the episode clock as evidence', async () => {
    const T_EPI = new Date(NOW.getTime() - 4 * 3600 * 1000); // older than the 3h compaction gap
    const { deps, supersedeFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'update',
              factId: KNOWN_FACT_ID,
              category: 'physical_constraint',
              fact: 'Shoulder recovered, light pressing OK',
              durability: 'short',
              ttlDays: 14,
              evidence: 'Что делаем сегодня?',
            },
          ],
        }),
    });
    const compact = buildCompactStep(deps);

    await compact(channelState({ lastUserMessageAt: T_EPI.toISOString() }), ctxConfig());

    expect(supersedeFact).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ factId: KNOWN_FACT_ID, fact: 'Shoulder recovered, light pressing OK' }),
      T_EPI,
      NOW,
      'summary-turn-1',
    );
  });

  it('retract: archives with the evidence clock — a retraction stated in the OLD episode closes at that time', async () => {
    const T_EPI = new Date(NOW.getTime() - 4 * 3600 * 1000); // older than the 3h compaction gap
    const { deps, retractFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'retract',
              factId: KNOWN_FACT_ID,
              reason: 'the user said it is fine now',
              evidence: 'Что делаем сегодня?',
            },
          ],
        }),
    });
    const compact = buildCompactStep(deps);

    await compact(channelState({ lastUserMessageAt: T_EPI.toISOString() }), ctxConfig());

    expect(retractFact).toHaveBeenCalledWith(
      USER_ID,
      { factId: KNOWN_FACT_ID, evidenceAt: T_EPI, reason: 'the user said it is fine now' },
      NOW,
    );
  });

  it('a PermanentFactRefusal downgrades that operation and the rest of the batch still applies', async () => {
    const { deps, rememberFact, confirmFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'add',
              category: 'physical_constraint',
              fact: 'Bad back forever',
              durability: 'permanent',
              evidence: 'Что делаем сегодня?',
            },
            { op: 'confirm', factId: KNOWN_FACT_ID },
          ],
        }),
    });
    rememberFact.mockRejectedValueOnce(new PermanentFactRefusal());
    const compact = buildCompactStep(deps);

    const update = await compact(channelState(), ctxConfig());

    // Not skipped, not lost: the permanent was retried as long_term (finding 2)...
    expect(rememberFact).toHaveBeenCalledTimes(2);
    expect(rememberFact.mock.calls[1][1]).toMatchObject({ durability: 'long_term' });
    // ...and the batch continued past it.
    expect(confirmFact).toHaveBeenCalledTimes(1);
    expect(removedIds(update)).toEqual(['m0', 'm0a']); // compaction unchanged
  });

  it('D-E: one operation throwing logs error and the compaction result is byte-identical to a run with no operations', async () => {
    const withOps: EpisodeSummaryV4 = {
      ...FIXED_SUMMARY,
      factOperations: [
        {
          op: 'add',
          category: 'equipment',
          fact: 'Has a squat rack',
          durability: 'short',
          ttlDays: 5,
          evidence: 'Что делаем сегодня?',
        },
      ],
    };
    const { deps: throwingDeps } = makeDeps({ structured: () => Promise.resolve(withOps) });
    const { deps: noOpsDeps } = makeDeps({
      structured: () => Promise.resolve({ ...FIXED_SUMMARY, factOperations: [] }),
    });
    (throwingDeps.userFacts as unknown as { rememberFact: jest.Mock }).rememberFact.mockRejectedValue(
      new Error('db down'),
    );

    const updateThrowing = await buildCompactStep(throwingDeps)(channelState(), ctxConfig());
    const updateNoOps = await buildCompactStep(noOpsDeps)(channelState(), ctxConfig());

    expect(removedIds(updateThrowing)).toEqual(removedIds(updateNoOps));
    expect(updateThrowing.episodeId).toEqual(updateNoOps.episodeId);
    expect(updateThrowing.episodeStartedAt).toEqual(updateNoOps.episodeStartedAt);
    expect(updateThrowing.compactReason).toEqual(updateNoOps.compactReason);
    expect(updateThrowing.episodeSummaries).toHaveLength(1);
    expect(updateNoOps.episodeSummaries).toHaveLength(1);
  });

  it('a summariser returning factOperations: [] applies nothing (no pointless port round-trips)', async () => {
    const { deps, rememberFact, confirmFact, supersedeFact, retractFact } = makeDeps({
      structured: () => Promise.resolve({ ...FIXED_SUMMARY, factOperations: [] }),
    });
    const compact = buildCompactStep(deps);

    await compact(channelState(), ctxConfig());

    expect(rememberFact).not.toHaveBeenCalled();
    expect(confirmFact).not.toHaveBeenCalled();
    expect(supersedeFact).not.toHaveBeenCalled();
    expect(retractFact).not.toHaveBeenCalled();
  });

  it('BR-LLM-004: a failed summariser writes no facts and still trims the episode', async () => {
    const { deps, rememberFact, insert } = makeDeps({
      structured: () => Promise.reject(new Error('provider down')),
    });
    const compact = buildCompactStep(deps);

    const update = await compact(channelState(), ctxConfig());

    expect(rememberFact).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(removedIds(update)).toEqual(['m0', 'm0a']); // trimming happened regardless
  });

  it('AC-CC-1: a too-short beyond-tail part kept verbatim writes no facts (no summariser ran)', async () => {
    const { deps, rememberFact, structured } = makeDeps({ config: { minTurns: 5 } });
    const compact = buildCompactStep(deps);

    const update = await compact(channelState(), ctxConfig());

    expect(structured).not.toHaveBeenCalled();
    expect(rememberFact).not.toHaveBeenCalled();
    expect(update.messages).toBeUndefined();
  });

  it('a failed known-facts load degrades to summarising without them — compaction itself unchanged', async () => {
    const { deps, getForPrompt, structured } = makeDeps();
    getForPrompt.mockRejectedValue(new Error('db down'));
    const compact = buildCompactStep(deps);

    const update = await compact(channelState(), ctxConfig());

    expect(structured).toHaveBeenCalledTimes(1);
    expect(removedIds(update)).toEqual(['m0', 'm0a']);
  });
});

// fact-verification plan Task 2 (D1): the string check is gone — these
// AC-FP cases keep their meaning (a coach-only figure is not stored) but the
// refusal now comes from the verifier verdict the stub answers with.
describe('buildCompactStep — fact provenance via the verifier (BUG-040, AC-FP-1..4)', () => {
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
      evidence: null,
    };
  }

  /** The BUG-040 episode: the removed (summarised) part is one human question + one assistant claim. */
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
      // fact-verification D1: the refusal is now the VERIFIER's verdict, not
      // the string check — the stub answers unsupported for the add.
      verdicts: { verdicts: [{ index: 0, supported: false, reason: 'the user never stated it' }] },
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState(HUMAN_LINE, AI_LINE), ctxConfig());

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
            },
          ],
        }),
      verdicts: { verdicts: [{ index: 0, supported: false, reason: 'the quote is the assistant’s own claim' }] },
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState(HUMAN_LINE, AI_LINE), ctxConfig());

    // The quote exists in the episode — but only in the ASSISTANT line: the
    // verifier says unsupported, so nothing is stored.
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
            },
          ],
        }),
      verdicts: { verdicts: [{ index: 0, supported: false, reason: 'the ~70% figure is the assistant’s' }] },
    });
    getForPrompt.mockResolvedValue([knownFact()]);
    const compact = buildCompactStep(deps);

    await compact(episodeState(HUMAN_LINE, AI_LINE), ctxConfig());

    // The user line is quoted, but the fact's numbers (45, 70) appear in NO user
    // message and not in the old fact text — the BUG-040 2075cb9f write. The
    // verifier's unsupported verdict is what refuses it now.
    expect(supersedeFact).not.toHaveBeenCalled();
  });

  it('AC-FP-2: add whose fact is clean but whose phaseNote carries a coach-only number is skipped — rememberFact not called', async () => {
    const { deps, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'add',
              category: 'physical_constraint',
              fact: 'Shoulder is recovering, still careful with overhead work',
              durability: 'long_term',
              phaseNote: 'the coach estimates the shoulder is ~70% recovered',
              evidence: 'плечо ещё побаливает',
            },
          ],
        }),
      verdicts: { verdicts: [{ index: 0, supported: false, reason: 'the phaseNote repeats the coach’s ~70%' }] },
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState('Плечо ещё побаливает', 'Восстановление идёт хорошо — уже ~70% позади.'), ctxConfig());

    // D12 legacy: the phaseNote repeats the coach's "~70%" — the verifier
    // sees it (D3) and answers unsupported.
    expect(rememberFact).not.toHaveBeenCalled();
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
            },
          ],
        }),
      verdicts: { verdicts: [{ index: 0, supported: false, reason: 'only the assistant said the shoulder is fine' }] },
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

    // The coach's "your shoulder is fine now" cannot close a user constraint —
    // the verifier's unsupported verdict refuses it.
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
            },
          ],
        }),
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState('Я жму лёжа 100 кг на 5 повторов', 'Отличный прогресс!'), ctxConfig());

    // The verifier's default stub verdict (supported) is what admits it now.
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

// fact-verification plan Task 2: the Task 1 repro cases, promoted (D1/D2/D5)
// — the gateway stub answers by schemaName, so the verifier call is what
// decides which mutating operations reach the facts port.
describe('buildCompactStep — fact verification (BUG-040 follow-up, AC-FV-1..4)', () => {
  /** The compacted (removed) episode: one human + one assistant line — same shape as the AC-FP block's. */
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

  it('AC-FV-1: a number stated in words by the user («пять дней») is stored when the verifier supports it', async () => {
    const { deps, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
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
        }),
      verdicts: { verdicts: [{ index: 0, supported: true, reason: 'the user said «пять дней» — five days' }] },
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState('Колено болит уже пять дней', 'Понял, скорректирую нагрузку на ноги.'), ctxConfig());

    expect(rememberFact).toHaveBeenCalledTimes(1);
    expect(rememberFact.mock.calls[0][1]).toMatchObject({ fact: 'Knee pain for 5 days' });
  });

  it('AC-FV-2: a verdict-unsupported coach claim is skipped; a supported sibling in the batch applies', async () => {
    const { deps, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
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
        }),
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
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'add',
              category: 'physical_constraint',
              fact: 'Knee is painful',
              durability: 'long_term',
              evidence: 'Колено болит',
            },
            { op: 'confirm', factId: '6e14cfe2-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
          ],
        }),
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
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [{ op: 'confirm', factId: '6e14cfe2-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
        }),
      verdicts: { verdicts: [] }, // if the verifier were wrongly called, it would void nothing here
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState('Колено болит', 'Скорректирую нагрузку.'), ctxConfig());

    expect(structured).toHaveBeenCalledTimes(1);
    expect(confirmFact).toHaveBeenCalledTimes(1);
  });

  it('AC-FV-4: a verdict list missing index 1 → operation 1 unsupported and not applied', async () => {
    const { deps, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
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
        }),
      verdicts: { verdicts: [{ index: 0, supported: true, reason: 'the user said it' }] }, // index 1 missing
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState('Я тренируюсь с гантелями', 'Рекомендую прогрессию нагрузки.'), ctxConfig());

    expect(rememberFact).toHaveBeenCalledTimes(1);
    expect(rememberFact.mock.calls[0][1]).toMatchObject({ fact: 'Trains with dumbbells' });
  });

  // fact-verification plan Task 5 (D18/D19): the verifier's per-verdict
  // `userQuote` — the user's own supporting words — is stored with the fact;
  // an empty quote falls back to the summariser's `evidence` hint. Both are
  // model output, no string matching (the owner's rule); the verifier's wins
  // because it decided the verdict.
  it('Task 5 (D18/D19): add stores the verifier’s userQuote as the fact’s evidence', async () => {
    const { deps, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'add',
              category: 'physical_constraint',
              fact: 'Knee pain for 5 days',
              durability: 'long_term',
              evidence: 'колено болит', // the hint LOSES to the verifier’s quote
            },
          ],
        }),
      verdicts: {
        verdicts: [
          { index: 0, supported: true, reason: 'the user said five days', userQuote: 'колено болит уже пять дней' },
        ],
      },
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState('Колено болит уже пять дней', 'Понял, скорректирую нагрузку.'), ctxConfig());

    expect(rememberFact).toHaveBeenCalledTimes(1);
    expect(rememberFact.mock.calls[0][1]).toMatchObject({
      fact: 'Knee pain for 5 days',
      evidence: 'колено болит уже пять дней',
    });
  });

  it('Task 5 (D18): an empty userQuote falls back to the summariser’s evidence hint', async () => {
    const { deps, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
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
        }),
      verdicts: {
        verdicts: [{ index: 0, supported: true, reason: 'the user said five days', userQuote: '' }],
      },
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState('Колено болит уже пять дней', 'Понял, скорректирую нагрузку.'), ctxConfig());

    expect(rememberFact).toHaveBeenCalledTimes(1);
    expect(rememberFact.mock.calls[0][1]).toMatchObject({ evidence: 'колено болит уже пять дней' });
  });

  it('Task 5 (D19): update stores the quote on the superseding row (the old row keeps its own)', async () => {
    const { deps, supersedeFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'update',
              factId: '6e14cfe2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              category: 'equipment',
              fact: 'Dumbbells up to 20kg',
              durability: 'long_term',
              evidence: 'купил новые гантели',
            },
          ],
        }),
      verdicts: {
        verdicts: [
          {
            index: 0,
            supported: true,
            reason: 'the user said it',
            userQuote: 'теперь у меня гантели до двадцати килограмм',
          },
        ],
      },
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState('Теперь у меня гантели до двадцати килограмм', 'Обновляю.'), ctxConfig());

    expect(supersedeFact).toHaveBeenCalledTimes(1);
    expect(supersedeFact.mock.calls[0][1]).toMatchObject({
      fact: 'Dumbbells up to 20kg',
      evidence: 'теперь у меня гантели до двадцати килограмм',
    });
  });

  it('Task 5 (D19): retract writes no quote — retractFact is called with no evidence', async () => {
    const { deps, retractFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'retract',
              factId: '6e14cfe2-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              reason: 'the user said the shoulder is fine now',
              evidence: 'плечо здорово',
            },
          ],
        }),
      verdicts: {
        verdicts: [{ index: 0, supported: true, reason: 'the user said it', userQuote: 'плечо уже не болит' }],
      },
    });
    const compact = buildCompactStep(deps);

    await compact(episodeState('Плечо уже не болит', 'Хорошо.'), ctxConfig());

    expect(retractFact).toHaveBeenCalledTimes(1);
    expect(retractFact.mock.calls[0][1]).not.toHaveProperty('evidence');
  });
});

describe('buildCompactStep — D-E legacy import (exactly once)', () => {
  function firstRunState(): ConversationStateType {
    // Live thread, first P4 run: history is empty (only this run's human message).
    return {
      ...channelState({
        messages: [new HumanMessage({ content: 'Привет', id: 'm9' })],
        lastUserMessageAt: null,
        episodeId: '',
      }),
    };
  }

  it('imports the latest legacy rolling summary as one episode summary', async () => {
    const { deps, latestLegacySummary } = makeDeps();
    latestLegacySummary.mockResolvedValue({
      text: 'User trains 3x/week, prefers upper/lower split.',
      phase: 'training',
      createdAt: new Date('2026-09-17T18:00:00Z'),
    });
    const compact = buildCompactStep(deps);

    const update = await compact(firstRunState(), ctxConfig());

    expect(update.episodeSummaries).toHaveLength(1);
    expect(update.episodeSummaries?.[0]).toMatchObject({
      phaseAtEnd: 'training',
      endedAt: '2026-09-17T18:00:00.000Z',
      summary: { topics: ['User trains 3x/week, prefers upper/lower split.'], decisions: [], userState: [] },
    });
    expect(update.messages).toBeUndefined(); // nothing removed
    expect(update.lastUserMessageAt).toBeUndefined(); // stays null — no greeting, no gap trigger
  });

  it('never imports again once episodeSummaries is non-empty (idempotent)', async () => {
    const { deps, latestLegacySummary } = makeDeps();
    const compact = buildCompactStep(deps);

    const update = await compact(
      {
        ...firstRunState(),
        episodeSummaries: [
          { episodeId: 'x', phaseAtEnd: 'chat', endedAt: '2026-09-17T18:00:00Z', summary: FIXED_SUMMARY },
        ],
      },
      ctxConfig(),
    );

    expect(latestLegacySummary).not.toHaveBeenCalled();
    expect(update).toEqual({});
  });

  it('history non-empty (not the first run) never imports', async () => {
    const { deps, latestLegacySummary } = makeDeps({ config: { gapMs: 24 * 3600 * 1000 } });
    const compact = buildCompactStep(deps);

    const update = await compact(
      channelState({ lastUserMessageAt: new Date(NOW.getTime() - 60_000).toISOString() }),
      ctxConfig(),
    );

    expect(latestLegacySummary).not.toHaveBeenCalled();
    expect(update).toEqual({});
  });

  // P4 close-out review advisory (b), BACKLOG "The D-E legacy-import branch in
  // compact.node.ts returns without consuming a pending state.compactReason":
  // a transition-plus-first-message combination must not leave the flag set
  // for the next run, whether or not a legacy summary was found.
  it('BACKLOG (b): consumes a pending compactReason even when no legacy summary is found', async () => {
    const { deps, latestLegacySummary } = makeDeps();
    latestLegacySummary.mockResolvedValue(null);
    const compact = buildCompactStep(deps);

    const update = await compact({ ...firstRunState(), compactReason: 'phase_boundary' }, ctxConfig());

    expect(update.compactReason).toBeNull();
    expect(update.episodeSummaries).toBeUndefined();
  });

  it('BACKLOG (b): consumes a pending compactReason when a legacy summary IS imported', async () => {
    const { deps, latestLegacySummary } = makeDeps();
    latestLegacySummary.mockResolvedValue({
      text: 'legacy text',
      phase: 'training',
      createdAt: new Date('2026-09-17T18:00:00Z'),
    });
    const compact = buildCompactStep(deps);

    const update = await compact({ ...firstRunState(), compactReason: 'phase_boundary' }, ctxConfig());

    expect(update.compactReason).toBeNull();
    expect(update.episodeSummaries).toHaveLength(1);
  });
});

describe('BACKLOG (a): id-less RemoveMessage fails loud instead of silently no-opping', () => {
  it('logs an error and skips the removal set when a history message has no id', async () => {
    const { deps } = makeDeps();
    const compact = buildCompactStep(deps);

    // Same fixture as channelState() but m0 has no id — RemoveMessage({id: ''})
    // would silently no-op, letting the budget/inactivity trigger refire every
    // run and the summary repeat per episode.
    const state: ConversationStateType = {
      ...channelState(),
      messages: [
        new HumanMessage({ content: 'Что делаем сегодня?' }), // no id
        new AIMessage({ content: 'Продолжаем план на грудь', id: 'm0a', tool_calls: [] }),
        new HumanMessage({ content: 'Составь план на грудь', id: 'm1' }),
        new AIMessage({ content: 'Готовим план', id: 'm2', tool_calls: [] }),
        new HumanMessage({ content: 'Спасибо', id: 'm3' }),
      ],
    };

    const update = await compact(state, ctxConfig());

    // No RemoveMessage set at all — never remove with '' (would resurrect m2 next run).
    expect(update.messages).toBeUndefined();
    // The episode is NOT rotated — compactReason is not consumed, so the trigger can retry
    // once the id gap is fixed upstream (this failure must be visible, not silently accepted).
    expect(update.episodeId).toBeUndefined();
    expect(update.compactReason).toBeUndefined();
  });
});

/** The manual pass's run context: the same run, flagged compact-only (`/compact`). */
function manualConfig(): RunnableConfig {
  const base = ctxConfig() as unknown as { context: object };
  return { ...base, context: { ...base.context, compactOnly: true } } as never;
}

describe('buildCompactStep — manual pass (/compact)', () => {
  /** The user's freshest turn is the LAST message; no human was appended for this pass. */
  function manualState(overrides: Partial<ConversationStateType> = {}): ConversationStateType {
    return channelState({
      messages: [
        new HumanMessage({ content: 'Составь план на грудь', id: 'm1' }),
        new AIMessage({ content: 'Готовим план', id: 'm2', tool_calls: [] }),
        new HumanMessage({ content: 'Колено болит', id: 'm3' }), // the freshest turn, unanswered
      ],
      lastUserMessageAt: NOW.toISOString(), // no gap — nothing automatic could fire
      ...overrides,
    });
  }

  it('folds the whole channel including the freshest user turn — no tail, whatever keepTurns says', async () => {
    const { deps, structured, insert } = makeDeps({ config: { keepTurns: 6 } });
    const compact = buildCompactStep(deps);

    const update = await compact(manualState(), manualConfig());

    expect(removedIds(update)).toEqual(['m1', 'm2', 'm3']);
    expect(JSON.stringify(structured.mock.calls[0]![1])).toContain('Колено болит');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(update.episodeId).toBe(RUN_ID);
  });

  it('the SAME state under an ordinary run keeps the current (last-human) turn out of reach', async () => {
    // Pins that splitEpisode's automatic-path invariant is untouched: only the
    // manual pass treats the whole channel as foldable.
    const { deps } = makeDeps({ config: { keepTurns: 0 } });
    const compact = buildCompactStep(deps);

    const update = await compact(manualState({ compactReason: 'phase_boundary' }), ctxConfig());

    expect(removedIds(update)).toEqual(['m1', 'm2']);
  });

  it('a short conversation is a clean no-op — no model call, no update at all', async () => {
    const { deps, structured, insert, latestLegacySummary } = makeDeps({ config: { minTurns: 3 } });
    const compact = buildCompactStep(deps);

    await expect(compact(manualState(), manualConfig())).resolves.toEqual({});

    expect(structured).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(latestLegacySummary).not.toHaveBeenCalled();
  });

  it('applies the summariser’s fact operations (evidence clock = the previous run’s stamp)', async () => {
    const { deps, rememberFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            {
              op: 'add',
              category: 'physical_constraint',
              fact: 'knee hurts',
              durability: 'long_term',
              evidence: 'Колено болит',
            },
          ],
        }),
    });
    const compact = buildCompactStep(deps);

    await compact(manualState(), manualConfig());

    expect(rememberFact).toHaveBeenCalledTimes(1);
  });

  it('BR-LLM-004 does NOT apply: a summariser failure throws, and nothing is returned to remove', async () => {
    const { deps, insert, rememberFact } = makeDeps({ structured: () => Promise.reject(new Error('provider down')) });
    const compact = buildCompactStep(deps);

    await expect(compact(manualState(), manualConfig())).rejects.toThrow('provider down');

    expect(insert).not.toHaveBeenCalled();
    expect(rememberFact).not.toHaveBeenCalled();
  });
});

describe('buildCompactStep — break facts (load-plan Task 4, D9, LOAD_PLAN_BREAKS)', () => {
  const BREAK_TEXT = 'break reason=illness from=2026-08-28 to=2026-09-18 — I had the flu';
  const summaryWith = (op: Record<string, unknown>) => () =>
    Promise.resolve({ ...FIXED_SUMMARY, factOperations: [op] } as unknown as EpisodeSummaryV4);
  const breakAdd = (fact: string, extra: Record<string, unknown> = {}) => ({
    op: 'add',
    category: 'break',
    fact,
    durability: 'long_term',
    evidence: 'Что делаем сегодня?',
    ...extra,
  });
  const promptsOf = (structured: jest.Mock): string[] =>
    (structured.mock.calls as unknown as [unknown, { role: string; content: string }[]][]).map(c =>
      c[1].map(m => m.content).join('\n'),
    );

  it('flag on: a well-formed break add is stored, its lifetime forced to short / 14 days / forget', async () => {
    const { deps, rememberFact } = makeDeps({ structured: summaryWith(breakAdd(BREAK_TEXT)) });
    const compact = buildCompactStep({ ...deps, loadPlanBreaks: true });

    await compact(channelState(), ctxConfig());

    expect(rememberFact).toHaveBeenCalledTimes(1);
    expect(rememberFact).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        category: 'break',
        fact: BREAK_TEXT,
        durability: 'short',
        ttlDays: 14,
        onExpiry: 'forget',
      }),
      NOW,
      'summary-turn-1',
    );
  });

  it('a malformed break add (unknown reason class, bad dates, free text) is skipped — nothing stored', async () => {
    for (const fact of [
      'break reason=vacation from=2026-08-28 to=2026-09-18 — trip',
      'break reason=illness from=last-week to=2026-09-18',
      'I was ill for three weeks',
    ]) {
      const { deps, rememberFact } = makeDeps({ structured: summaryWith(breakAdd(fact)) });
      await buildCompactStep({ ...deps, loadPlanBreaks: true })(channelState(), ctxConfig());
      expect(rememberFact).not.toHaveBeenCalled();
    }
  });

  it('an update of the asked-marker placeholder supersedes it with the real reason', async () => {
    const { deps, supersedeFact } = makeDeps({
      structured: summaryWith({
        op: 'update',
        factId: '5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        category: 'break',
        fact: BREAK_TEXT,
        durability: 'short',
        evidence: 'Что делаем сегодня?',
      }),
    });
    await buildCompactStep({ ...deps, loadPlanBreaks: true })(channelState(), ctxConfig());
    expect(supersedeFact).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ category: 'break', fact: BREAK_TEXT, durability: 'short', ttlDays: 14 }),
      expect.any(Date),
      NOW,
      'summary-turn-1',
    );
  });

  it('flag on: summariser v7 (with the BREAK FACTS section and the episode date) and verifier v2 run', async () => {
    const { deps, structured } = makeDeps({ structured: summaryWith(breakAdd(BREAK_TEXT)) });
    await buildCompactStep({ ...deps, loadPlanBreaks: true })(channelState(), ctxConfig());
    const [summariser, verifier] = promptsOf(structured);
    expect(summariser).toContain('BREAK FACTS');
    expect(summariser).toContain('the episode date is 2026-09-18');
    expect(verifier).toContain('A "break" fact');
  });

  it('flag off: summariser v6 and verifier v1 exactly — no break section anywhere', async () => {
    const { deps, structured } = makeDeps({
      structured: summaryWith({
        op: 'add',
        category: 'physical_constraint',
        fact: 'Broken wrist',
        durability: 'long_term',
        reviewInDays: 60,
        evidence: 'Что делаем сегодня?',
      }),
    });
    await buildCompactStep(deps)(channelState(), ctxConfig());
    const [summariser, verifier] = promptsOf(structured);
    expect(summariser).not.toContain('BREAK FACTS');
    expect(verifier).not.toContain('"break" fact');
  });
});

describe('buildCompactStep — progression_scheme facts (load-plan Task 5a, D8, A6)', () => {
  const SCHEME_TEXT = 'progression_scheme id=double_progression — I want to progress by reps';
  const summaryWith = (op: Record<string, unknown>) => () =>
    Promise.resolve({ ...FIXED_SUMMARY, factOperations: [op] } as unknown as EpisodeSummaryV4);
  const schemeAdd = (fact: string, extra: Record<string, unknown> = {}) => ({
    op: 'add',
    category: 'progression_scheme',
    fact,
    durability: 'short',
    ttlDays: 3,
    evidence: 'Что делаем сегодня?',
    ...extra,
  });
  const promptsOf = (structured: jest.Mock): string[] =>
    (structured.mock.calls as unknown as [unknown, { role: string; content: string }[]][]).map(c =>
      c[1].map(m => m.content).join('\n'),
    );

  it('LOAD_PLAN_SUGGESTION on: a registry id is stored, lifetime forced to long_term / review in 182 days', async () => {
    const { deps, rememberFact } = makeDeps({ structured: summaryWith(schemeAdd(SCHEME_TEXT)) });
    await buildCompactStep({ ...deps, loadPlanSuggestion: true })(channelState(), ctxConfig());
    expect(rememberFact).toHaveBeenCalledTimes(1);
    expect(rememberFact).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        category: 'progression_scheme',
        fact: SCHEME_TEXT,
        durability: 'long_term',
        reviewInDays: 182,
        ttlDays: undefined,
      }),
      NOW,
      'summary-turn-1',
    );
  });

  it('an unknown scheme id, a wrong shape or free text is rejected at apply time — nothing stored', async () => {
    for (const fact of [
      'progression_scheme id=rpe_autoregulation — x',
      'progression_scheme id=constructor',
      'I want progression by reps',
    ]) {
      const { deps, rememberFact } = makeDeps({ structured: summaryWith(schemeAdd(fact)) });
      await buildCompactStep({ ...deps, loadPlanSuggestion: true })(channelState(), ctxConfig());
      expect(rememberFact).not.toHaveBeenCalled();
    }
  });

  it('an update of the known scheme fact (change of mind) supersedes it', async () => {
    const { deps, supersedeFact } = makeDeps({
      structured: summaryWith({
        op: 'update',
        factId: '5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        category: 'progression_scheme',
        fact: 'progression_scheme id=linear_progression — just add weight each time',
        durability: 'long_term',
        evidence: 'Что делаем сегодня?',
      }),
    });
    await buildCompactStep({ ...deps, loadPlanSuggestion: true })(channelState(), ctxConfig());
    expect(supersedeFact).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ category: 'progression_scheme', durability: 'long_term', reviewInDays: 182 }),
      expect.any(Date),
      NOW,
      'summary-turn-1',
    );
  });

  it('a category whose flag is off is dropped at apply time: scheme without LOAD_PLAN_SUGGESTION, break without LOAD_PLAN_BREAKS', async () => {
    const a = makeDeps({ structured: summaryWith(schemeAdd(SCHEME_TEXT)) });
    await buildCompactStep({ ...a.deps, loadPlanBreaks: true })(channelState(), ctxConfig());
    expect(a.rememberFact).not.toHaveBeenCalled();
    const b = makeDeps({
      structured: summaryWith({
        op: 'add',
        category: 'break',
        fact: 'break reason=illness from=2026-08-28 to=2026-09-18 — flu',
        durability: 'short',
        evidence: 'Что делаем сегодня?',
      }),
    });
    await buildCompactStep({ ...b.deps, loadPlanSuggestion: true })(channelState(), ctxConfig());
    expect(b.rememberFact).not.toHaveBeenCalled();
  });

  it('A6 selection: suggestion only → v7 with the scheme section and no break section; breaks only → the reverse', async () => {
    const s = makeDeps({ structured: summaryWith(schemeAdd(SCHEME_TEXT)) });
    await buildCompactStep({ ...s.deps, loadPlanSuggestion: true })(channelState(), ctxConfig());
    const [summariser, verifier] = promptsOf(s.structured);
    expect(summariser).toContain('PROGRESSION SCHEME');
    expect(summariser).toContain('double_progression | linear_progression');
    expect(summariser).not.toContain('BREAK FACTS');
    expect(verifier).toContain('"progression_scheme" fact');
    const b = makeDeps({ structured: summaryWith(schemeAdd(SCHEME_TEXT)) });
    await buildCompactStep({ ...b.deps, loadPlanBreaks: true })(channelState(), ctxConfig());
    const [breakOnly] = promptsOf(b.structured);
    expect(breakOnly).toContain('BREAK FACTS');
    expect(breakOnly).not.toContain('PROGRESSION SCHEME');
    const both = makeDeps({ structured: summaryWith(schemeAdd(SCHEME_TEXT)) });
    await buildCompactStep({ ...both.deps, loadPlanBreaks: true, loadPlanSuggestion: true })(
      channelState(),
      ctxConfig(),
    );
    const [all] = promptsOf(both.structured);
    expect(all).toContain('BREAK FACTS');
    expect(all).toContain('PROGRESSION SCHEME');
  });

  it('both flags off: v6 exactly — no scheme or break section anywhere', async () => {
    const { deps, structured } = makeDeps({ structured: summaryWith(schemeAdd(SCHEME_TEXT)) });
    await buildCompactStep(deps)(channelState(), ctxConfig());
    const [summariser, verifier] = promptsOf(structured);
    expect(summariser).not.toContain('PROGRESSION SCHEME');
    expect(summariser).not.toContain('BREAK FACTS');
    expect(verifier).not.toContain('"progression_scheme" fact');
  });
});
