/**
 * commit (ADR-0013 §4.1/§4.3, refactor-p3-run-context-commit Task 4; P4
 * Task 4 reworks it): projects this run's messages into `conversation_turns`
 * (the transcript of record), writes the run row, decides the transition
 * against the domain matrix and guards, and raises the typed transition event
 * (handlers do the side effects, awaited in order — D-C). The `messages`
 * channel PERSISTS — compaction (prepare of the next run) is the only way
 * messages leave it (INV-LLM-002).
 */
import { createHash } from 'node:crypto';

import { AIMessage, type BaseMessage, ToolMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import type { TransitionHandler } from '@domain/conversation/events';
import type { ConversationPhase } from '@domain/conversation/phases';
import type { IConversationRunService, TranscriptPort } from '@domain/conversation/ports';
import { evaluateTransition } from '@domain/conversation/transitions';

import { splitEpisode, toTranscriptMessages } from '@infra/ai/graph/episode';
import { type ConversationStateType, ctxOf } from '@infra/ai/graph/state';
import { promptVersionsForPhase } from '@infra/ai/prompts';
import { outcomeKindOf } from '@infra/ai/tools/outcome';

import { createLogger } from '@shared/logger';

const log = createLogger('commit-node');

function collectToolCalls(messages: BaseMessage[]): Array<{ name: string; argsHash: string; outcomeKind: string }> {
  const result: Array<{ name: string; argsHash: string; outcomeKind: string }> = [];
  for (const m of messages) {
    if (m._getType() !== 'ai') {
      continue;
    }
    const ai = m as AIMessage;
    for (const call of ai.tool_calls ?? []) {
      const match = messages.find(
        other => other._getType() === 'tool' && (other as ToolMessage).tool_call_id === call.id,
      ) as ToolMessage | undefined;
      result.push({
        name: call.name,
        argsHash: createHash('sha1')
          .update(JSON.stringify(call.args ?? {}))
          .digest('hex'),
        outcomeKind: match ? outcomeKindOf(match) : 'ok',
      });
    }
  }
  return result;
}

export interface CommitNodeDeps {
  transcript: TranscriptPort;
  runService: IConversationRunService;
  onTransition: TransitionHandler[];
  /**
   * transition-handoff plan Task 2 (D-1): same targets tool-executor uses —
   * a committed transition to one of these loops `commit` back to `route`
   * instead of ending the run. Optional like courseCheckEnabled; absent/empty
   * = off (today's single-commit-per-run behaviour, byte-for-byte).
   */
  transitionHandoffTargets?: ReadonlySet<ConversationPhase>;
}

export function buildCommitNode(deps: CommitNodeDeps) {
  const { transcript, runService, onTransition } = deps;
  const handoffTargets = deps.transitionHandoffTargets ?? new Set<ConversationPhase>();

  return async function commitNode(
    state: ConversationStateType,
    config: RunnableConfig,
  ): Promise<Partial<ConversationStateType>> {
    const ctx = ctxOf(config as never);
    const { userId, runId } = ctx;
    const { phase } = state;

    // Task 2 (D-3): this call's position on the run's phase path. Pushed
    // BEFORE the hop decision, so its length after the push is 1 on the
    // looping commit and 2 on the final commit — the "already hopped" guard
    // (max 1 hop, no revisit) and, once > 1, D-2's `transition.path`.
    ctx.phasePath = [...(ctx.phasePath ?? []), phase];
    const isFirstCommitOfRun = ctx.phasePath.length === 1;
    const hopBoundaryIndex = ctx.hopBoundaryIndex ?? 0;

    // 1. Project only the messages NOT already projected this run (Task 2:
    //    a hop's second commit must not re-send what the first one sent) —
    //    D-I: only the messages from the last HumanMessage on; D-K: one row
    //    per message plus one per tool call. Failure must not fail the reply
    //    (BR-CONV-007) but is logged at error.
    const { current } = splitEpisode(state.messages);
    const toProject = current.slice(hopBoundaryIndex);
    if (toProject.length > 0) {
      try {
        await transcript.appendRunMessages({
          userId,
          runId,
          phase,
          episodeId: state.episodeId,
          messages: toTranscriptMessages(toProject),
        });
      } catch (err) {
        log.error({ err, userId, phase, runId }, 'Failed to project run messages — continuing');
      }
    }

    // 2. Evaluate the transition against the domain matrix and guards.
    const request = state.pendingTransition ?? null;
    const verdict = request ? evaluateTransition({ phase, activeSessionId: state.activeSessionId, request }) : null;
    if (request && !verdict?.ok) {
      // Not an error; logged info (ADR §6).
      log.info({ userId, from: phase, to: request.toPhase, reason: verdict?.reason }, 'Blocked transition');
    }

    // Task 2 (AC-TH-1/AC-TH-3): loop back to `route` — no second run row, no
    // second projection base, `prepare` is skipped entirely — only on the
    // FIRST commit of the run, when the committed target is a hand-off target.
    const shouldHop = isFirstCommitOfRun && !!verdict?.ok && handoffTargets.has(verdict.toPhase);
    ctx.hopping = shouldHop;
    if (shouldHop && request) {
      // The final commit's OWN `request` is null by then (this commit already
      // cleared pendingTransition) — its run row still needs the toPhase/reason
      // that caused the hop.
      ctx.hopTransition = request;
    }

    // 3. The run row — observability, never fails the reply. Skipped on the
    //    looping commit (Task 2): one row per RUN, written by the final commit.
    if (!shouldHop) {
      const metrics = ctx.metrics.snapshot();
      const fromPhase = ctx.phasePath[0] ?? phase;
      const hopped = ctx.phasePath.length > 1;
      const promptVersions = hopped
        ? { ...promptVersionsForPhase(fromPhase), ...promptVersionsForPhase(phase) }
        : promptVersionsForPhase(phase);
      const budgetReport = metrics.budgetReport ? { ...metrics.budgetReport, assemblies: metrics.assemblies } : null;
      let phaseOut: ConversationPhase | null = null;
      if (verdict?.ok) {
        phaseOut = verdict.toPhase;
      } else if (hopped) {
        phaseOut = phase;
      }
      // This call's own request when there is one, else (a hopped run's final
      // commit, which has none of its own) the request that caused the hop.
      const effectiveTransition = request ?? (hopped ? (ctx.hopTransition ?? null) : null);
      const transitionPath = hopped ? ctx.phasePath : undefined;
      try {
        await runService.recordRun({
          runId,
          userId,
          phaseIn: fromPhase,
          phaseOut,
          trigger: ctx.trigger,
          client: ctx.client,
          model: metrics.model,
          promptVersions,
          tokensIn: metrics.tokensIn,
          tokensOut: metrics.tokensOut,
          latencyMs: metrics.latencyMs,
          toolCalls: collectToolCalls(current),
          transition: effectiveTransition
            ? { toPhase: effectiveTransition.toPhase, reason: effectiveTransition.reason, path: transitionPath }
            : null,
          outcome: 'ok',
          budgetReport,
        });
        log.info(
          {
            runId,
            phase: fromPhase,
            model: metrics.model,
            promptVersions,
            tokensIn: metrics.tokensIn,
            tokensOut: metrics.tokensOut,
            latencyMs: metrics.latencyMs,
            llmCalls: metrics.llmCalls,
            budgetReport,
          },
          'Conversation run recorded',
        );
      } catch (err) {
        log.warn({ err, userId, phase, runId }, 'Failed to record conversation run — continuing');
      }
    }

    // 4. Committed transition → the typed event, handlers awaited in order.
    //    The final commit of a hop must not reset what the looping commit's
    //    handlers already set (Task 2): default to the CURRENT state, not a
    //    hardcoded null/unchanged — a call with no transition of its own
    //    (verdict is null) leaves both exactly as they came in.
    let { activeSessionId, compactReason } = state;
    if (verdict?.ok) {
      const event = {
        type: 'phase_transition_committed' as const,
        userId,
        runId,
        from: phase,
        to: verdict.toPhase,
        reason: request?.reason ?? null,
        activeSessionId: state.activeSessionId,
        at: ctx.now,
      };
      for (const handler of onTransition) {
        try {
          const { activeSessionId: sessionFromHandler, compactReason: reasonFromHandler } = await handler(event);
          if (sessionFromHandler !== undefined) {
            activeSessionId = sessionFromHandler;
          }
          if (reasonFromHandler !== undefined) {
            compactReason = reasonFromHandler;
          }
        } catch (err) {
          log.error({ err, userId, from: phase, to: verdict.toPhase }, 'Transition handler failed — continuing');
        }
      }
    }

    // Task 2: the looping commit records where the second phase's messages
    // start in `current` — the final commit's projection cutoff and
    // `runAiText`'s delivery cutoff (the adapter reads this after the whole
    // run finishes). Left alone on the final commit — it stays the boundary
    // for the whole run.
    if (shouldHop) {
      ctx.hopBoundaryIndex = current.length;
    }

    // 5. Durable state after the run: the new phase, no pending transition,
    //    the handler-merged session id, the compaction flag, and — new in P4 —
    //    NO `messages` key: the channel persists (INV-LLM-002); `compact` is
    //    the only thing that removes messages.
    return {
      phase: verdict?.ok ? verdict.toPhase : phase,
      pendingTransition: null,
      activeSessionId,
      compactReason,
      lastUserMessageAt: ctx.now.toISOString(),
      // The run's one-shot expiry questions have been asked; the checkpoint at rest never carries them.
      courseExpiryQuestions: [],
    };
  };
}
