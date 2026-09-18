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

import type { CompactReason } from '@domain/conversation/episode';
import type { TransitionHandler } from '@domain/conversation/events';
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
}

export function buildCommitNode(deps: CommitNodeDeps) {
  const { transcript, runService, onTransition } = deps;

  return async function commitNode(
    state: ConversationStateType,
    config: RunnableConfig,
  ): Promise<Partial<ConversationStateType>> {
    const ctx = ctxOf(config as never);
    const { userId, runId } = ctx;
    const { phase } = state;

    // 1. Project this run's messages into the transcript (D-I: only the
    //    messages from the last HumanMessage on; D-K: one row per message
    //    plus one per tool call). Failure must not fail the reply
    //    (BR-CONV-007) but is logged at error.
    const { current } = splitEpisode(state.messages);
    if (current.length > 0) {
      try {
        await transcript.appendRunMessages({
          userId,
          runId,
          phase,
          episodeId: state.episodeId,
          messages: toTranscriptMessages(current),
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

    // 3. The run row — observability, never fails the reply.
    const metrics = ctx.metrics.snapshot();
    const promptVersions = promptVersionsForPhase(phase);
    const budgetReport = metrics.budgetReport ? { ...metrics.budgetReport, assemblies: metrics.assemblies } : null;
    try {
      await runService.recordRun({
        runId,
        userId,
        phaseIn: phase,
        phaseOut: verdict?.ok ? verdict.toPhase : null,
        trigger: ctx.trigger,
        client: ctx.client,
        model: metrics.model,
        promptVersions,
        tokensIn: metrics.tokensIn,
        tokensOut: metrics.tokensOut,
        latencyMs: metrics.latencyMs,
        toolCalls: collectToolCalls(current),
        transition: request ? { toPhase: request.toPhase, reason: request.reason } : null,
        outcome: 'ok',
        budgetReport,
      });
      log.info(
        {
          runId,
          phase,
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

    // 4. Committed transition → the typed event, handlers awaited in order.
    let { activeSessionId } = state;
    let compactReason: CompactReason | null = null;
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
    };
  };
}
