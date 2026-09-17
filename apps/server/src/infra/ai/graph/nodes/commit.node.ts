/**
 * commit (ADR-0013 §4.1/§4.3, refactor-p3-run-context-commit Task 4):
 * persists the turn and the run row, decides the transition against the
 * domain matrix and guards, raises the typed transition event (handlers do
 * the side effects, awaited in order — D-C), and clears `messages` (P4
 * stops the clearing).
 */
import { createHash } from 'node:crypto';

import { AIMessage, type BaseMessage, HumanMessage, RemoveMessage, ToolMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { REMOVE_ALL_MESSAGES } from '@langchain/langgraph';

import type { TransitionHandler } from '@domain/conversation/events';
import type { IConversationContextService, IConversationRunService } from '@domain/conversation/ports';
import { evaluateTransition } from '@domain/conversation/transitions';

import { type ConversationStateType, ctxOf } from '@infra/ai/graph/state';
import { textOf } from '@infra/ai/llm.gateway';
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
  contextService: IConversationContextService;
  runService: IConversationRunService;
  onTransition: TransitionHandler[];
}

export function buildCommitNode(deps: CommitNodeDeps) {
  const { contextService, runService, onTransition } = deps;

  return async function commitNode(
    state: ConversationStateType,
    config: RunnableConfig,
  ): Promise<Partial<ConversationStateType>> {
    const ctx = ctxOf(config as never);
    const { userId, runId } = ctx;
    const { phase } = state;

    // 1. Persist the turn — analytics failure must not break the reply.
    const human = state.messages.find(m => m._getType() === 'human') as HumanMessage | undefined;
    const ai = [...state.messages].reverse().find(m => m._getType() === 'ai') as AIMessage | undefined;
    const humanText = human !== undefined ? textOf(human.content) : '';
    const aiText = ai !== undefined ? textOf(ai.content) : '';
    if (humanText && aiText) {
      try {
        await contextService.appendTurn(userId, phase, humanText, aiText);
      } catch (err) {
        log.error({ err, userId, phase }, 'Failed to persist conversation turn — continuing');
      }
    }
    ctx.metrics.finalText = aiText || null;

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
        toolCalls: collectToolCalls(state.messages),
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
          const { activeSessionId: fromHandler } = await handler(event);
          if (fromHandler !== undefined) {
            activeSessionId = fromHandler;
          }
        } catch (err) {
          log.error({ err, userId, from: phase, to: verdict.toPhase }, 'Transition handler failed — continuing');
        }
      }
    }

    // 5. Durable state after the run: the new phase, no pending transition,
    //    the handler-merged session id, and no leftover messages.
    return {
      phase: verdict?.ok ? verdict.toPhase : phase,
      pendingTransition: null,
      activeSessionId,
      messages: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES })],
    };
  };
}
