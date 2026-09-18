/**
 * The compact step (ADR-0013 §3.3, §4.1 as amended): synchronous, inside
 * `prepare`, before the phase sync — never fire-and-forget, at most once per
 * run. Ends the previous episode by rule (BR-LLM-001..003), turns it into
 * one independent structured summary (BR-LLM-004; summariser failure
 * degrades to trimming without a summary), keeps the last 3 summaries oldest
 * first, and is the ONLY writer that removes messages from the channel
 * (INV-LLM-002). Also owns the one-time legacy import for live threads (D-E).
 */
import { RemoveMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import type { LlmGateway } from '@domain/ai/ports';
import type { ChatMsg } from '@domain/ai/types';
import { type EpisodeSummary, EpisodeSummarySchema, type StoredEpisodeSummary } from '@domain/conversation/episode';
import type { ConversationPhase } from '@domain/conversation/phases';
import type { LegacySummary, SummaryPort } from '@domain/conversation/ports';

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
}

export interface CompactStepDeps {
  llmGateway: LlmGateway;
  summaries: SummaryPort;
  config: EpisodeTunables;
  /** PhaseSpec.budget.history (D-D) — the BR-LLM-003 trigger input. */
  budgetFor: (phase: ConversationPhase) => number;
}

export type CompactStep = (
  state: ConversationStateType,
  config: RunnableConfig,
) => Promise<Partial<ConversationStateType>>;

export function buildCompactStep(deps: CompactStepDeps): CompactStep {
  const { llmGateway, summaries, config, budgetFor } = deps;
  const { gapMs, minTurns, minTokens } = config;

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
          summary: { topics: [legacy.text], decisions: [], userState: [], trainingFeedback: [], openItems: [] },
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

    const { removed } = planCompaction({ history, reason, historyBudget, estimate: estimateMessages });

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
    }

    log.info({ userId, runId, reason, removed: removed.length, summarised: summary !== null }, 'Episode compacted');
    return updates;
  };
}
