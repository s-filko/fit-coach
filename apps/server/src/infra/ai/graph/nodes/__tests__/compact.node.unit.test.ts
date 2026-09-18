/**
 * The compact step (BR-LLM-001..004, D-E; refactor-p4-episode-memory Task 6):
 * synchronous, inside prepare, at most once per run. Summariser failure
 * degrades to trimming without a summary; the summary port is best-effort;
 * the legacy rolling summary is imported exactly once for live threads.
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import type { EpisodeSummary, StoredEpisodeSummary } from '@domain/conversation/episode';
import type { SummaryPort } from '@domain/conversation/ports';
import type { LlmGateway } from '@domain/ai/ports';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import type { ConversationStateType } from '../../state';
import { buildCompactStep, type EpisodeTunables } from '../compact.node';

const NOW = new Date('2026-09-18T12:00:00Z');
const RUN_ID = 'run-2';
const EPISODE_ID = 'run-1';
const USER_ID = 'u1';

const FIXED_SUMMARY: EpisodeSummary = {
  topics: ['plan discussed'],
  decisions: ['upper/lower split'],
  userState: ['mild shoulder discomfort'],
  trainingFeedback: [],
  openItems: ['day 2 not logged'],
};

/** Run 1's traffic (with ids — RemoveMessage needs them) + run 2's human message. */
function channelState(overrides: Partial<ConversationStateType> = {}): ConversationStateType {
  return {
    phase: 'chat',
    activeSessionId: null,
    messages: [
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

function makeDeps(overrides: { config?: Partial<EpisodeTunables>; structured?: () => Promise<EpisodeSummary> } = {}) {
  const insert = jest.fn<Promise<void>, Parameters<SummaryPort['insert']>[0][]>().mockResolvedValue(undefined);
  const latestLegacySummary = jest.fn().mockResolvedValue(null);
  const structured = jest
    .fn()
    .mockImplementation(() => (overrides.structured ? overrides.structured() : Promise.resolve(FIXED_SUMMARY)));
  const deps = {
    llmGateway: { chat: jest.fn(), structured } as unknown as LlmGateway,
    summaries: { insert, latestLegacySummary } as unknown as SummaryPort,
    config: { gapMs: 3 * 3600 * 1000, minTurns: 0, minTokens: 0, ...overrides.config },
    budgetFor: () => 1_000_000,
  };
  return { deps, insert, latestLegacySummary, structured };
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

    expect(removedIds(update)).toEqual(['m1', 'm2']);
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
    const { deps, insert, structured } = makeDeps({ structured: () => Promise.reject(new Error('provider down')) });
    const compact = buildCompactStep(deps);

    const update = await compact(channelState(), ctxConfig());

    expect(structured).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
    expect(removedIds(update)).toEqual(['m1', 'm2']);
    expect(update.episodeSummaries).toBeUndefined();
  });

  it('summary insert failure is logged, not thrown (best-effort)', async () => {
    const { deps, insert } = makeDeps();
    insert.mockRejectedValue(new Error('db down'));
    const compact = buildCompactStep(deps);

    const update = await compact(channelState(), ctxConfig());

    expect(insert).toHaveBeenCalledTimes(1);
    expect(removedIds(update)).toEqual(['m1', 'm2']); // trimming happened regardless
  });

  it('D-B: a short episode is trimmed WITHOUT a model call', async () => {
    const { deps, insert, structured } = makeDeps({ config: { minTurns: 5 } });
    const compact = buildCompactStep(deps);

    const update = await compact(channelState(), ctxConfig());

    expect(structured).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(removedIds(update)).toEqual(['m1', 'm2']);
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
    expect(removedIds(update)).toEqual(['m1', 'm2']);
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

    expect(removedIds(update)).toEqual(['m1', 'm2']);
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
      schemaName: 'episode_summary',
      runId: RUN_ID,
      userId: USER_ID,
    });
    void schema;
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
});
