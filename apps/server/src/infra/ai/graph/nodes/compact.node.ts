/**
 * The compact step (ADR-0013 §3.3, §4.1 as amended): synchronous, inside
 * `prepare`, before the phase sync — never fire-and-forget, at most once per
 * run. Ends the previous episode by rule (BR-LLM-001..003), turns it into
 * one independent structured summary (BR-LLM-004; summariser failure
 * degrades to trimming without a summary), keeps the last `EPISODE_KEEP_TURNS`
 * turns verbatim — nothing is dropped without a summary unless the budget
 * forces it (AC-CC-1) — keeps the last 3 summaries oldest
 * first, and is the ONLY writer that removes messages from the channel
 * (INV-LLM-002). Also owns the one-time legacy import for live threads (D-E).
 *
 * P6 Task 3 (owner decision 2026-09-17): this is the ONLY path that ever
 * writes a `user_facts` row — there is no per-turn fact-writing tool and none
 * may be added. After a successful `summaries.insert`, `summary.facts` (the
 * summariser's own structured output, P6 Task 2) is upserted via
 * `IUserFactsService.upsertMany`. D-E: a failed fact upsert logs `error` and
 * the compaction result is otherwise unchanged — a fact write is a
 * nice-to-have, compaction is on the critical path.
 */
import { RemoveMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import type { LlmGateway } from '@domain/ai/ports';
import type { ChatMsg } from '@domain/ai/types';
import { type EpisodeSummary, EpisodeSummarySchema, type StoredEpisodeSummary } from '@domain/conversation/episode';
import type { ConversationPhase } from '@domain/conversation/phases';
import type { LegacySummary, SummaryPort } from '@domain/conversation/ports';
import type { IUserFactsService } from '@domain/user/ports';

import { estimateMessages } from '@infra/ai/context/token-estimator';
import { splitEpisode } from '@infra/ai/graph/episode';
import { type ConversationStateType, ctxOf } from '@infra/ai/graph/state';
import { episodeParagraph } from '@infra/ai/prompts/blocks';
import { SUMMARIZER_PROMPT } from '@infra/ai/prompts/summarizer';

import { createLogger } from '@shared/logger';

import { decideCompactReason, isShortEpisode, planCompaction, renderTranscript } from './compact';

const log = createLogger('compact-node');

/** The D-L tunables, resolved once at the composition root (never read mid-run). */
export interface EpisodeTunables {
  /** EPISODE_GAP_HOURS × 3_600_000 (BR-LLM-001). */
  gapMs: number;
  /** EPISODE_MIN_TURNS (D-B). */
  minTurns: number;
  /** EPISODE_MIN_TOKENS (D-B). */
  minTokens: number;
  /** EPISODE_KEEP_TURNS — the verbatim tail every trigger keeps (AC-CC-1). */
  keepTurns: number;
}

export interface CompactStepDeps {
  llmGateway: LlmGateway;
  summaries: SummaryPort;
  /** P6 Task 3: the only fact-writing path — no per-turn fact tool exists or may exist (owner decision 2026-09-17). */
  userFacts: IUserFactsService;
  config: EpisodeTunables;
  /** PhaseSpec.budget.history (D-D) — the BR-LLM-003 trigger input. */
  budgetFor: (phase: ConversationPhase) => number;
}

export type CompactStep = (
  state: ConversationStateType,
  config: RunnableConfig,
) => Promise<Partial<ConversationStateType>>;

export function buildCompactStep(deps: CompactStepDeps): CompactStep {
  const { llmGateway, summaries, userFacts, config, budgetFor } = deps;
  const { gapMs, minTurns, minTokens, keepTurns } = config;

  return async function compactStep(state, config): Promise<Partial<ConversationStateType>> {
    const ctx = ctxOf(config as never);
    const { userId, runId } = ctx;
    const { history } = splitEpisode(state.messages);

    // D-E: live-thread import, exactly once — the first P4 run sees an empty
    // history and no episode summaries, and imports the legacy rolling
    // summary as the one prior episode so users keep their context.
    if (history.length === 0 && state.episodeSummaries.length === 0) {
      const legacy: LegacySummary | null = await summaries.latestLegacySummary(userId).catch((err: unknown) => {
        log.error({ err, userId }, 'Legacy summary read failed — skipping the one-time import');
        return null;
      });
      if (legacy) {
        const imported: StoredEpisodeSummary = {
          episodeId: state.episodeId || runId,
          phaseAtEnd: legacy.phase,
          endedAt: legacy.createdAt.toISOString(),
          summary: {
            topics: [legacy.text],
            decisions: [],
            userState: [],
            trainingFeedback: [],
            openItems: [],
            facts: [], // pre-P4 legacy import has no structured facts (Task 2)
          },
        };
        log.info({ userId, phase: legacy.phase }, 'Imported the legacy rolling summary as one episode');
        // BACKLOG (b): this branch must also consume a pending compactReason —
        // a transition-plus-first-message run would otherwise leave the flag
        // set for the next run.
        return { episodeSummaries: [imported], compactReason: null };
      }
      // BACKLOG (b): no legacy summary found — still consume the flag, if any.
      return { compactReason: null };
    }

    const historyBudget = budgetFor(state.phase);
    const reason = decideCompactReason({
      state,
      history,
      now: ctx.now,
      gapMs,
      historyBudget,
      estimate: estimateMessages,
    });
    if (reason === null) {
      return {};
    }
    if (history.length === 0) {
      // The flag fired but there is no episode to end — consume it, that is all.
      return { compactReason: null };
    }

    const { removed } = planCompaction({
      history,
      reason,
      historyBudget,
      estimate: estimateMessages,
      keepTurns,
      minTurns,
      minTokens,
    });

    if (removed.length === 0) {
      // AC-CC-1: the beyond-tail part is too short to summarise (D-B) — it
      // stays verbatim and rides along until a later compaction can summarise
      // it (supersedes D-B's trim-without-summary). The episode does not
      // rotate; only the trigger flag is consumed.
      log.info(
        { userId, runId, reason, history: history.length },
        'Compaction deferred — the beyond-tail part is too short to summarise (AC-CC-1)',
      );
      return { compactReason: null };
    }

    // BACKLOG (a): `new RemoveMessage({ id: '' })` silently no-ops for an
    // id-less message — the trigger would refire every run and a summary
    // could repeat per episode. Fail loud instead: skip the whole removal
    // set (never remove with '') and leave compactReason untouched so the
    // trigger retries once the id gap is fixed upstream.
    const idlessCount = removed.filter(m => !m.id).length;
    if (idlessCount > 0) {
      log.error(
        { userId, runId, reason, idlessCount, removed: removed.length },
        'Compaction skipped this run — one or more history messages have no id; RemoveMessage requires one',
      );
      return {};
    }

    const updates: Partial<ConversationStateType> = {
      messages: removed.map(m => new RemoveMessage({ id: m.id as string })),
      // D-O: the new episode starts with this run.
      episodeId: runId,
      episodeStartedAt: ctx.now.toISOString(),
      compactReason: null,
    };

    if (isShortEpisode(removed, { minTurns, minTokens, estimate: estimateMessages })) {
      // Budget-only today (AC-CC-1): inactivity/transition never get here —
      // planCompaction defers a too-short beyond-tail part instead — but a
      // budget cut may still have to drop a short oldest part to fit.
      log.info({ userId, reason, removed: removed.length }, 'Short episode trimmed without a summary (D-B)');
      return updates;
    }

    let summary: EpisodeSummary | null = null;
    try {
      const sections = SUMMARIZER_PROMPT.render({ phase: state.phase, transcript: renderTranscript(removed) });
      const messages: ChatMsg[] = sections.map(s => ({
        role: s.id === 'system' ? 'system' : 'user',
        content: s.text,
      }));
      summary = await llmGateway.structured(EpisodeSummarySchema, messages, {
        profile: 'summarizer',
        schemaName: 'episode_summary',
        runId,
        userId,
      });
    } catch (err) {
      log.warn({ err, userId, runId, reason }, 'Episode summariser failed — trimming without a summary (BR-LLM-004)');
    }

    if (summary) {
      const stored: StoredEpisodeSummary = {
        episodeId: state.episodeId || runId,
        phaseAtEnd: state.phase,
        endedAt: ctx.now.toISOString(),
        summary,
      };
      try {
        await summaries.insert({
          userId,
          runId,
          episodeId: stored.episodeId,
          phaseAtEnd: stored.phaseAtEnd,
          structured: summary,
          rendered: episodeParagraph(stored, ctx.now, ctx.user.timezone ?? null),
        });
      } catch (err) {
        log.error({ err, userId, runId }, 'Episode summary insert failed — the run continues without it');
      }
      updates.episodeSummaries = [...state.episodeSummaries, stored].slice(-3);

      // P6 Task 3 (owner decision 2026-09-17): the ONLY fact-writing path — no
      // per-turn fact tool. Own try/catch, independent of the summary insert
      // above: a failed or skipped fact write must never change what this
      // function returns (D-E). Skip the call entirely when there is nothing
      // to write — no pointless round-trip for the (common) empty-facts case.
      if (summary.facts.length > 0) {
        try {
          await userFacts.upsertMany(userId, summary.facts);
        } catch (err) {
          log.error({ err, userId, runId }, 'User facts upsert failed — the run continues without it');
        }
      }
    }

    log.info({ userId, runId, reason, removed: removed.length, summarised: summary !== null }, 'Episode compacted');
    return updates;
  };
}
