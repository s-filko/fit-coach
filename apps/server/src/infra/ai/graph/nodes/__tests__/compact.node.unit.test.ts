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
    upsertMany?: () => Promise<number>;
  } = {},
) {
  const insert = jest
    .fn<Promise<{ summaryTurnId: string }>, Parameters<SummaryPort['insert']>[0][]>()
    .mockResolvedValue({ summaryTurnId: 'summary-turn-1' });
  const latestLegacySummary = jest.fn().mockResolvedValue(null);
  const structured = jest
    .fn()
    .mockImplementation(() => (overrides.structured ? overrides.structured() : Promise.resolve(FIXED_SUMMARY)));
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
            { op: 'add', category: 'equipment', fact: 'Has a barbell', durability: 'short', ttlDays: 5 },
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
            { op: 'add', category: 'equipment', fact: 'Has a barbell', durability: 'short', ttlDays: 5 },
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
            { op: 'add', category: 'equipment', fact: 'Has a barbell', durability: 'short', ttlDays: 5 },
          ],
        }),
    });
    const compact = buildCompactStep(deps);

    // phase_boundary forces compaction without the inactivity gap (which needs
    // lastUserMessageAt to measure) — the exact no-episode-timestamp case.
    await compact(channelState({ lastUserMessageAt: null, compactReason: 'phase_boundary' }), ctxConfig());

    expect(rememberFact.mock.calls[0][1].evidenceAt).toEqual(NOW);
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
          factOperations: [{ op: 'retract', factId: KNOWN_FACT_ID, reason: 'the user said it is fine now' }],
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

  it('a PermanentFactRefusal on one operation skips it and the rest of the batch still applies', async () => {
    const { deps, rememberFact, confirmFact } = makeDeps({
      structured: () =>
        Promise.resolve({
          ...FIXED_SUMMARY,
          factOperations: [
            { op: 'add', category: 'physical_constraint', fact: 'Bad back forever', durability: 'permanent' },
            { op: 'confirm', factId: KNOWN_FACT_ID },
          ],
        }),
    });
    rememberFact.mockRejectedValueOnce(new PermanentFactRefusal());
    const compact = buildCompactStep(deps);

    const update = await compact(channelState(), ctxConfig());

    expect(rememberFact).toHaveBeenCalledTimes(1);
    expect(confirmFact).toHaveBeenCalledTimes(1); // the batch continued
    expect(removedIds(update)).toEqual(['m0', 'm0a']); // compaction unchanged
  });

  it('D-E: one operation throwing logs error and the compaction result is byte-identical to a run with no operations', async () => {
    const withOps: EpisodeSummaryV4 = {
      ...FIXED_SUMMARY,
      factOperations: [{ op: 'add', category: 'equipment', fact: 'Has a squat rack', durability: 'short', ttlDays: 5 }],
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
