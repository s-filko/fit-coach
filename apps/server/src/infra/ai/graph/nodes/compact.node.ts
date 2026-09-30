/**
 * The compact step (ADR-0013 §3.3, §4.1 as amended): synchronous, inside
 * `prepare`, before the phase sync — never fire-and-forget, at most once per
 * run. Ends the previous episode by rule (BR-LLM-001..003), turns it into
 * one independent structured summary (BR-LLM-004; summariser failure
 * degrades to trimming without a summary), keeps the last `EPISODE_KEEP_TURNS`
 * turns verbatim and never drops a part without summarising it (AC-CC-1,
 * ADR-0013 §3.3 amendment 2026-09-20: a too-short part is kept at
 * inactivity/transition, and a budget cut is always summarised), keeps the
 * last 3 summaries oldest
 * first, and is the ONLY writer that removes messages from the channel
 * (INV-LLM-002). Also owns the one-time legacy import for live threads (D-E).
 *
 * Fact operations (fact-lifecycle plan Task 3, AC-FL-4 — reverses the P6
 * 2026-09-17 no-per-turn-tool stance, which Task 2's `manage_fact` already
 * ended): the episode summariser (v4/v5/v6 — one shared EpisodeSummaryV4Schema)
 * SEES the user's known active facts and returns operations (add / confirm /
 * update / retract) instead of a blind upsert. BUG-040 follow-up
 * (fact-verification plan): add/update/retract are further guarded by ONE
 * model call — `verifyFactOperations` (D2/D6) re-checks each mutating
 * operation against the same transcript the summariser saw and only supported
 * ones are applied; `confirm` is exempt. A rejected operation logs (op,
 * factId, a verdict status — never the fact text nor the verifier's free-text
 * reason, D8/D14) and the batch
 * continues; a failed verifier call fails CLOSED (D5) — every mutating
 * operation of that compaction is skipped, the summary and the `confirm`s
 * still apply.
 * After a successful `summaries.insert`, this node applies each operation via
 * the facts port. TWO CLOCKS (AC-FL-3): every written date uses the run clock
 * ctx.now, while the EVIDENCE time is the compacted episode's newest user
 * message (state.lastUserMessageAt — still the previous run's stamp here), so
 * an old restatement can never re-open a fact the user closed after that
 * episode. D-E: a failed or malformed operations payload logs and changes
 * nothing — fact writes are nice-to-have, compaction is on the critical path.
 */
import { RemoveMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import type { LlmGateway } from '@domain/ai/ports';
import type { ChatMsg } from '@domain/ai/types';
import {
  type CompactReason,
  type EpisodeSummaryV4,
  EpisodeSummaryV4Schema,
  type FactOperation,
  type StoredEpisodeSummary,
} from '@domain/conversation/episode';
import type { ConversationPhase } from '@domain/conversation/phases';
import type { LegacySummary, SummaryPort } from '@domain/conversation/ports';
import type { IUserFactsService } from '@domain/user/ports';
import { PermanentFactRefusal } from '@domain/user/services/fact-lifecycle';

import { estimateMessages } from '@infra/ai/context/token-estimator';
import { splitEpisode } from '@infra/ai/graph/episode';
import { type ConversationStateType, ctxOf } from '@infra/ai/graph/state';
import { episodeParagraph } from '@infra/ai/prompts/blocks';
import { SUMMARIZER_PROMPT } from '@infra/ai/prompts/summarizer';

import { createLogger } from '@shared/logger';

import { decideCompactReason, planCompaction, renderTranscript } from './compact';
import { type FactVerdictMap, verifyFactOperations } from './verify-fact-operations';

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
  /**
   * EPISODE_BUDGET_LOW_WATER (AC-SI-5a, BUG-038 part 1): a budget-triggered
   * cut targets at most this fraction of `historyBudget`, not just-fits —
   * the headroom keeps ordinary turns right after a compaction from crossing
   * the cap again and re-triggering compaction every run. Optional — omitted
   * reproduces the old just-fits behaviour (equivalent to 1), so existing
   * callers that build this config without it are unaffected.
   */
  budgetLowWater?: number;
  /**
   * Prompt-caching plan D5: LLM_PROMPT_CACHE_TTL in ms — set only with LLM_PROMPT_CACHE=anthropic (unset = no
   * deferral, today's behaviour). The cache counts as warm while the previous message of this user is younger
   * than this (`state.lastUserMessageAt`, no extra query; a hit refreshes the TTL, so measuring from the user's
   * message is the conservative side).
   */
  cacheTtlMs?: number;
  /** LLM_CONTEXT_HARD_CAP_TOKENS — the estimated total above which deferral gives way. */
  hardCapTokens?: number;
}

export interface CompactStepDeps {
  llmGateway: LlmGateway;
  summaries: SummaryPort;
  /** Fact-lifecycle Task 3: applies the summariser's fact operations (AC-FL-4). */
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
  const { gapMs, minTurns, minTokens, keepTurns, budgetLowWater = 1, cacheTtlMs, hardCapTokens } = config;

  return async function compactStep(state, config): Promise<Partial<ConversationStateType>> {
    const ctx = ctxOf(config as never);
    const { userId, runId } = ctx;
    // The manual pass (`/compact`) appended NO HumanMessage, so there is no
    // "current run" for splitEpisode to protect: cutting at the last human
    // message would leave the user's freshest turn unfolded and, in a short
    // conversation, an empty history. The whole channel is foldable. The
    // automatic paths keep splitEpisode's invariant untouched (one appended
    // human per run; compaction never cuts into it).
    const manual = ctx.compactOnly === true;
    const history = manual ? [...state.messages] : splitEpisode(state.messages).history;

    // D-E: live-thread import, exactly once — the first P4 run sees an empty
    // history and no episode summaries, and imports the legacy rolling
    // summary as the one prior episode so users keep their context. Never on
    // the manual pass: an empty channel there is simply nothing to compact.
    if (!manual && history.length === 0 && state.episodeSummaries.length === 0) {
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
    // D5: warm cache → the budget trigger waits unless the estimated total (history + this run's messages) is over
    // the hard cap. Only used by the automatic budget trigger; inactivity / phase_boundary ignore it.
    const warmSince = state.lastUserMessageAt !== null ? ctx.now.getTime() - Date.parse(state.lastUserMessageAt) : null;
    const cacheWarm =
      cacheTtlMs !== undefined && hardCapTokens !== undefined && warmSince !== null && warmSince < cacheTtlMs
        ? { hardCapTokens, estimatedTotalTokens: estimateMessages(state.messages) }
        : null;
    const reason: CompactReason | null = manual
      ? 'manual'
      : decideCompactReason({
          state,
          history,
          now: ctx.now,
          gapMs,
          historyBudget,
          estimate: estimateMessages,
          cacheWarm,
        });
    if (reason === 'budget' && cacheWarm) {
      log.info(
        { userId, phase: state.phase, estimatedTotal: cacheWarm.estimatedTotalTokens, cap: cacheWarm.hardCapTokens },
        'Context hard cap reached while cache warm',
      );
    }
    if (reason === null) {
      return {};
    }
    if (history.length === 0) {
      if (manual) {
        return {};
      }
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
      lowWaterMark: budgetLowWater,
    });

    if (removed.length === 0) {
      if (manual) {
        // Too short to summarise: a clean no-op — no model call, nothing
        // touched (the pending automatic flag, if any, is left for its own run).
        log.info({ userId, runId, history: history.length }, 'Manual compaction: nothing to compact');
        return {};
      }
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
      if (manual) {
        throw new Error(`Manual compaction refused — ${idlessCount} history message(s) have no id`);
      }
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

    // AC-FL-4: the summariser sees the user's known active facts so it can
    // confirm/correct/retract instead of blind-upserting. A failed load
    // degrades to an empty list — the summariser can still add.
    let knownFacts: Awaited<ReturnType<IUserFactsService['getForPrompt']>> = [];
    try {
      knownFacts = await userFacts.getForPrompt(userId, ctx.now);
    } catch (err) {
      log.error({ err, userId, runId }, 'Known facts load failed — summarising without them');
    }

    let summary: EpisodeSummaryV4 | null = null;
    // D3: the verifier must see the SAME transcript the summariser saw.
    const transcript = renderTranscript(removed);
    try {
      const sections = SUMMARIZER_PROMPT.render({
        phase: state.phase,
        transcript,
        knownFacts,
      });
      const messages: ChatMsg[] = sections.map(s => ({
        role: s.id === 'system' ? 'system' : 'user',
        content: s.text,
      }));
      summary = await llmGateway.structured(EpisodeSummaryV4Schema, messages, {
        profile: 'summarizer',
        schemaName: 'episode_summary_v4',
        runId,
        userId,
      });
    } catch (err) {
      // The two paths differ ON PURPOSE — do not unify them. An automatic
      // trigger fires inside a reply the user is waiting for, so a silent
      // trim without a summary (BR-LLM-004) beats breaking that reply. A
      // manual /compact has no reply to protect: the user asked for the fold,
      // so a failed summariser must throw — nothing has been removed (the
      // updates above are only returned on success) and the user is told
      // honestly instead of losing their conversation to a promised summary.
      if (manual) {
        throw err;
      }
      log.warn({ err, userId, runId, reason }, 'Episode summariser failed — trimming without a summary (BR-LLM-004)');
    }

    if (summary) {
      const stored: StoredEpisodeSummary = {
        episodeId: state.episodeId || runId,
        phaseAtEnd: state.phase,
        endedAt: ctx.now.toISOString(),
        summary,
      };
      // fact-lifecycle plan Task 1: the mirrored summary turn row is the honest
      // provenance of the facts this summarisation extracts — facts are born
      // out of it, so they cite its id as source_turn_id. Left undefined when
      // the insert fails; the fact write below stays independent regardless (D-E).
      let summaryTurnId: string | undefined;
      try {
        ({ summaryTurnId } = await summaries.insert({
          userId,
          runId,
          episodeId: stored.episodeId,
          phaseAtEnd: stored.phaseAtEnd,
          structured: summary,
          rendered: episodeParagraph(stored, ctx.now, ctx.user.timezone ?? null),
        }));
      } catch (err) {
        log.error({ err, userId, runId }, 'Episode summary insert failed — the run continues without it');
      }
      updates.episodeSummaries = [...state.episodeSummaries, stored].slice(-3);

      // fact-lifecycle Task 3: apply the summariser's operations. Own try/catch
      // PER OPERATION, independent of the summary insert above: a failed or
      // refused operation must never change what this function returns (D-E) or
      // stop the rest of the batch. Skip everything when there is nothing to
      // apply — no pointless round-trips for the (common) empty case.
      // Malformed payloads must never change the compaction result (D-E): a
      // stubbed or degraded gateway answer without the field applies nothing.
      const operations = summary.factOperations ?? [];
      if (operations.length > 0) {
        // AC-FL-3's evidence clock: the compacted episode's newest user message
        // (still the PREVIOUS run's stamp at this point). Facts stated in that
        // episode can be no newer than this; ctx.now would let a restatement
        // leapfrog a closure that happened in between.
        const evidenceAt = state.lastUserMessageAt ? new Date(state.lastUserMessageAt) : ctx.now;
        // BUG-040 follow-up (fact-verification D2/D6): ONE verifier call per
        // compaction, only when at least one MUTATING operation came back —
        // `confirm` never changes text and is exempt (fact-provenance D3
        // kept). null = the call threw or was unparsable: fail CLOSED (D5),
        // every mutating operation below reads as unsupported, while the
        // summary and the confirms still apply.
        const mutating = operations.filter(op => op.op !== 'confirm');
        let verdicts: FactVerdictMap | null = null;
        if (mutating.length > 0) {
          verdicts = await verifyFactOperations({
            llmGateway,
            transcript,
            operations: mutating,
            knownFacts,
            runId,
            userId,
          });
        }
        let mutatingIndex = -1; // the verifier numbers the mutating ops 0..n-1, in this order
        for (const op of operations) {
          const isMutating = op.op !== 'confirm';
          if (isMutating) {
            mutatingIndex += 1;
          }
          const verdict = isMutating ? verdicts?.get(mutatingIndex) : undefined;
          try {
            if (isMutating && !verdict?.supported) {
              // D14 (D8): op, factId and a verdict status only — the
              // verifier's free-text reason can quote the user's words, so
              // it never enters the log; nor does the fact text.
              let verdictStatus: 'unsupported' | 'verdict-missing' | 'verifier-failed';
              if (verdict) {
                verdictStatus = 'unsupported';
              } else if (verdicts === null) {
                verdictStatus = 'verifier-failed';
              } else {
                verdictStatus = 'verdict-missing';
              }
              log.info(
                {
                  userId,
                  runId,
                  op: op.op,
                  factId: op.factId ?? null,
                  verdict: verdictStatus,
                },
                'Fact operation skipped — the verifier did not support it (BUG-040 follow-up)',
              );
              continue;
            }
            // Task 5 (D18): the quote stored with the fact — the verifier's
            // userQuote when it gave one, else the summariser's evidence hint.
            // Both are model output, no string matching (the owner's rule); the
            // verifier's is preferred because it decided the verdict. Only
            // add/update consume it (D19) — retract/confirm write no quote.
            const userQuote = verdict?.userQuote ?? '';
            const quote = userQuote !== '' ? userQuote : (op.evidence ?? null);
            await applyFactOperation(userFacts, userId, op, quote, evidenceAt, ctx.now, summaryTurnId);
          } catch (err) {
            if (err instanceof PermanentFactRefusal) {
              log.info({ userId, runId, op: op.op }, 'Fact operation skipped — permanent refused without the gate');
            } else {
              log.error({ err, userId, runId, op: op.op }, 'Fact operation failed — the run continues without it');
            }
          }
        }
      }
    }

    log.info({ userId, runId, reason, removed: removed.length, summarised: summary !== null }, 'Episode compacted');
    return updates;
  };
}

/**
 * Applies ONE summariser fact operation (AC-FL-4). Malformed operations (a
 * missing factId, or an add without category/fact/durability) are skipped
 * silently — the schema verifies UUID FORMAT only, so a well-formed invented id
 * simply matches no row later (a no-op), and the compaction result
 * must never depend on operation shape (D-E).
 */
async function applyFactOperation(
  userFacts: IUserFactsService,
  userId: string,
  op: FactOperation,
  /** D18: the user's supporting quote — written by add/update only (D19). */
  quote: string | null,
  evidenceAt: Date,
  now: Date,
  sourceTurnId: string | undefined,
): Promise<void> {
  switch (op.op) {
    case 'add': {
      if (op.category === undefined || op.fact === undefined || op.durability === undefined) {
        return;
      }
      await rememberFromEpisode(
        userFacts,
        userId,
        {
          category: op.category,
          fact: op.fact,
          muscleGroup: op.muscleGroup ?? null,
          durability: op.durability,
          ttlDays: op.ttlDays,
          reviewInDays: op.reviewInDays,
          phaseNote: op.phaseNote ?? null,
          onExpiry: op.onExpiry,
          context: 'stated in a compacted episode',
          evidence: quote,
          explicitPermanent: op.explicitPermanent,
          evidenceAt,
        },
        now,
        sourceTurnId,
      );
      return;
    }
    case 'confirm': {
      if (op.factId === undefined) {
        return;
      }
      // D-C: the counter moves, the stored text never does.
      await userFacts.confirmFact(userId, op.factId, now);
      return;
    }
    case 'update': {
      if (
        op.factId === undefined ||
        op.category === undefined ||
        op.fact === undefined ||
        op.durability === undefined
      ) {
        return;
      }
      await supersedeFromEpisode(
        userFacts,
        userId,
        {
          factId: op.factId,
          category: op.category,
          fact: op.fact,
          muscleGroup: op.muscleGroup ?? null,
          durability: op.durability,
          ttlDays: op.ttlDays,
          reviewInDays: op.reviewInDays,
          phaseNote: op.phaseNote ?? null,
          onExpiry: op.onExpiry,
          context: 'corrected in a compacted episode',
          evidence: quote,
          explicitPermanent: op.explicitPermanent,
        },
        evidenceAt,
        now,
        sourceTurnId,
      );
      return;
    }
    case 'retract': {
      if (op.factId === undefined) {
        return;
      }
      await userFacts.retractFact(userId, { factId: op.factId, evidenceAt, reason: op.reason }, now);
      return;
    }
  }
}

/**
 * Close-out finding 2: a compaction-sourced `permanent` must never be LOST.
 * When the permanent gate does not open (the episode did not establish
 * irreversibility in the user's own words), the fact is retried as `long_term`
 * at the class-minimum review date, with a context note saying why — a fact the
 * coach must not forget is recorded for review, not dropped. The live tool
 * path keeps its refusal-and-ask behaviour: only the summariser path downgrades.
 */
const PERMANENCE_NOTE = 'recorded for review as long_term: permanence was not established';

async function rememberFromEpisode(
  userFacts: IUserFactsService,
  userId: string,
  input: Parameters<IUserFactsService['rememberFact']>[1],
  now: Date,
  sourceTurnId: string | undefined,
): Promise<void> {
  try {
    await userFacts.rememberFact(userId, input, now, sourceTurnId);
  } catch (err) {
    if (!(err instanceof PermanentFactRefusal)) {
      throw err;
    }
    await userFacts.rememberFact(
      userId,
      {
        ...input,
        durability: 'long_term',
        ttlDays: undefined,
        onExpiry: undefined,
        context: `${input.context ?? ''} — ${PERMANENCE_NOTE}`.replace(/^ — /, ''),
      },
      now,
      sourceTurnId,
    );
  }
}

async function supersedeFromEpisode(
  userFacts: IUserFactsService,
  userId: string,
  input: Parameters<IUserFactsService['supersedeFact']>[1],
  evidenceAt: Date,
  now: Date,
  sourceTurnId: string | undefined,
): Promise<void> {
  try {
    await userFacts.supersedeFact(userId, input, evidenceAt, now, sourceTurnId);
  } catch (err) {
    if (!(err instanceof PermanentFactRefusal)) {
      throw err;
    }
    await userFacts.supersedeFact(
      userId,
      {
        ...input,
        durability: 'long_term',
        ttlDays: undefined,
        onExpiry: undefined,
        context: `${input.context ?? ''} — ${PERMANENCE_NOTE}`.replace(/^ — /, ''),
      },
      evidenceAt,
      now,
      sourceTurnId,
    );
  }
}
