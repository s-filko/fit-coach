/**
 * The shared tool executor (ADR-0013 §4.2/§4.4/§6) — the ONLY place that
 * turns tool returns into messages and state. Tools never import LangGraph;
 * they return `ToolReturn` (decision D-A) and the executor serialises each
 * outcome with `toToolMessage` v1, collects `ToolStateUpdate`s and enforces
 * the phase's `ToolPolicy` (ordering, dedup, error budget, system-error stop).
 */
import { AIMessage, type BaseMessage, ToolMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { END } from '@langchain/langgraph';

import type { ConversationPhase } from '@domain/conversation/phases';
import {
  isToolReturnWithUpdate,
  llmError,
  ok,
  type ToolReturn,
  type ToolStateUpdate,
} from '@domain/conversation/tool-outcome';
import type { TransitionRequest } from '@domain/conversation/transitions';

import { ctxOf } from '@infra/ai/graph/state';
import { langOf, t } from '@infra/ai/messages';
import { outcomeKindOf, toToolMessage } from '@infra/ai/tools/outcome';

import { createLogger } from '@shared/logger';

import {
  BATCH_DUPLICATE_MESSAGE,
  buildSearchKey,
  findDuplicateCalls,
  sortToolCallsByPriority,
  type ToolCallLike,
  type ToolPolicy,
} from './tool-policy';

const log = createLogger('tool-executor');

type InvokableTool = {
  invoke: (args: Record<string, unknown>, config: RunnableConfig) => Promise<unknown>;
};

/** The slice of ConversationState the executor reads. */
export interface ToolExecutorState {
  messages: BaseMessage[];
  activeSessionId?: string | null;
}

export type ToolExecutorUpdate = {
  messages: BaseMessage[];
  pendingTransition?: TransitionRequest;
  activeSessionId?: string;
};

/** A plain-string return is still an ok outcome — same rendering ToolNode gives it. */
function normalizeReturn(ret: unknown): ToolReturn {
  if (typeof ret === 'string') {
    return ok(ret);
  }
  return ret as ToolReturn;
}

export function buildToolExecutor(
  tools: StructuredToolInterface[],
  policy: ToolPolicy,
  /** transition-handoff plan Task 1 (D-5): targets that get the carrier AIMessage's text emptied. */
  handoffTargets: ReadonlySet<ConversationPhase> = new Set(),
): (state: ToolExecutorState, config: RunnableConfig) => Promise<ToolExecutorUpdate> {
  const toolMap = Object.fromEntries(tools.map(t => [t.name, t])) as Record<string, InvokableTool>;

  return async (state, config) => {
    const ctx = ctxOf(config as never);
    const lang = langOf(ctx.user?.languageCode);
    // Duck-typed (_getType, not instanceof): jest.resetModules in subgraph tests
    // re-evaluates @langchain/core and produces a second AIMessage class, which
    // would make instanceof checks fail inside the executor.
    const lastMessage = state.messages[state.messages.length - 1] as Partial<AIMessage> | undefined;
    const calls = (
      lastMessage && lastMessage._getType?.() === 'ai' && Array.isArray(lastMessage.tool_calls)
        ? lastMessage.tool_calls
        : []
    ) as ToolCallLike[];
    if (calls.length === 0) {
      return { messages: [] };
    }

    // No ordering in the policy → no reordering (stable call order); the
    // bare sortToolCallsByPriority() default of TRAINING_TOOL_PRIORITY stays
    // available to the ADR-0011 tests and the training wiring.
    const sorted = sortToolCallsByPriority(calls, policy.ordering ?? {});
    const duplicateIds = new Set(findDuplicateCalls(sorted, policy.batchDedup ?? []));
    const perTurnDedup = policy.perTurnDedup ?? [];

    const newMessages: BaseMessage[] = [];
    // Per-turn dedup cache: key → rendered result (lives only for this batch)
    const resultCache = new Map<string, string>();
    let updates: ToolStateUpdate = {};
    let systemError = false;

    const countLlmErrors = (msgs: BaseMessage[]): number => {
      let count = 0;
      for (const m of msgs) {
        if (m instanceof ToolMessage && outcomeKindOf(m as ToolMessage) === 'llm_error') {
          count += 1;
        }
      }
      return count;
    };

    for (const call of sorted) {
      if (duplicateIds.has(call.id ?? '')) {
        log.warn(
          { userId: ctx.userId, tool: call.name },
          'Duplicate tool calls detected in batch — rejecting all duplicates',
        );
        newMessages.push(toToolMessage(llmError(BATCH_DUPLICATE_MESSAGE(call.name)), call.id ?? ''));
        continue;
      }
      // A system error ends the run — no further calls in this batch execute
      // (earlier ones already ran, same as training today). D-J: every call is
      // still ANSWERED — with persistence, an unanswered tool_call would be
      // replayed to the provider next run and the request rejected.
      if (systemError) {
        newMessages.push(
          toToolMessage(llmError('Skipped: an earlier tool in this batch failed with a system error'), call.id ?? ''),
        );
        continue;
      }

      if (perTurnDedup.includes(call.name)) {
        const cacheKey = `${call.name}:${buildSearchKey(call.args)}`;
        const cached = resultCache.get(cacheKey);
        if (cached !== undefined) {
          log.debug({ userId: ctx.userId, tool: call.name }, 'per-turn dedup hit — reusing result');
          newMessages.push(new ToolMessage({ tool_call_id: call.id ?? '', content: cached }));
          continue;
        }
      }

      const targetTool = toolMap[call.name];
      if (!targetTool) {
        newMessages.push(toToolMessage(llmError(`Unknown tool: ${call.name}`), call.id ?? ''));
        continue;
      }

      // Pass the node's config through so LangChain callbacks (the eval
      // ToolRecorder, the LLM log handler's metadata) keep firing exactly as
      // with ToolNode (ADR-0013 §8 P0 note: runId rides config.metadata).
      const toolConfig: RunnableConfig = {
        ...config,
        configurable: {
          ...config.configurable,
          userId: ctx.userId,
          activeSessionId: state.activeSessionId ?? null,
          runId: ctx.runId,
        },
      };

      let ret: unknown;
      try {
        ret = await targetTool.invoke(call.args, toolConfig);
      } catch (err) {
        let message = err instanceof Error ? err.message : String(err);
        // A schema rejection carries no recovery cue unless we add one. The Zod
        // text above the cue already names the offending field, so the cue only
        // says how to fix and re-call — it must never invent a cause. The ONE
        // tool-specific cue that is real: an exercise-id rejection (dev-smoke
        // 2026-09-17: the model invented exerciseIds and gave up) keeps the
        // search_exercises sentence. Anything else gets the generic cue — the
        // 2026-09-21 live smoke showed a hardcoded hint pointing a manage_fact
        // enum error at search_exercises ids is worse than no hint: the model
        // abandoned the call and reported success it did not have.
        if (message.includes('did not match expected schema')) {
          const exerciseIdRejected = /exerciseId/i.test(message);
          message += exerciseIdRejected
            ? `\nFix the arguments and call ${call.name} again: every id must be a UUID copied verbatim from the search_exercises results (the "ID:..." line), never invented or abbreviated.`
            : `\nFix the arguments and call ${call.name} again: correct the field named in the error above, using its exact name and allowed values from the tool's schema.`;
        }
        log.warn({ userId: ctx.userId, tool: call.name, err: message, args: call.args }, 'Tool invocation failed');
        newMessages.push(toToolMessage(llmError(message), call.id ?? ''));
        continue;
      }

      const toolReturn = normalizeReturn(ret);
      const outcome = isToolReturnWithUpdate(toolReturn) ? toolReturn.outcome : toolReturn;
      if (isToolReturnWithUpdate(toolReturn)) {
        // Last write wins per field
        updates = { ...updates, ...toolReturn.update };
      }
      if (!outcome.ok && outcome.kind === 'system_error') {
        systemError = true;
      }
      const message = toToolMessage(outcome, call.id ?? '');
      newMessages.push(message);
      if (perTurnDedup.includes(call.name)) {
        resultCache.set(`${call.name}:${buildSearchKey(call.args)}`, String(message.content));
      }
    }

    // Fail immediately on any systemic error — no retry makes sense (as
    // training's agentNode does today; D-D keeps HTTP 200 until P5).
    if (systemError) {
      log.error({ userId: ctx.userId }, 'System error detected in tools — stopping');
      newMessages.push(new AIMessage(t('tool_system_error', lang)));
      return finish(newMessages, updates);
    }

    // Error budget: previous batches plus this one; Infinity never exhausts.
    const toolErrorCount = countLlmErrors(state.messages) + countLlmErrors(newMessages);
    if (toolErrorCount > policy.llmErrorBudget) {
      log.warn({ userId: ctx.userId, toolErrorCount }, 'Tool error retry budget exhausted');
      newMessages.push(new AIMessage(t('tool_error_budget_exhausted', lang)));
      return finish(newMessages, updates);
    }

    // Hand-off (D-5): a committed transition to a hand-off target empties the
    // carrier AIMessage's text — same id, so the reducer replaces it in place —
    // so nothing this phase wrote reaches the next phase or the user. `id` is
    // only absent in hand-built test state that bypasses the graph; production
    // messages always carry one by the time they reach this node (ADR-0013 §4.1).
    if (updates.pendingTransition && handoffTargets.has(updates.pendingTransition.toPhase) && lastMessage?.id) {
      newMessages.push(new AIMessage({ id: lastMessage.id, content: '', tool_calls: lastMessage.tool_calls ?? [] }));
    }

    return finish(newMessages, updates);
  };
}

/** Applies the ToolStateUpdate fields to the durable state channels. */
function finish(newMessages: BaseMessage[], updates: ToolStateUpdate): ToolExecutorUpdate {
  return {
    messages: newMessages,
    ...(updates.pendingTransition !== undefined ? { pendingTransition: updates.pendingTransition } : {}),
    ...(updates.activeSessionId !== undefined ? { activeSessionId: updates.activeSessionId } : {}),
  };
}

/**
 * Conditional edge after the executor (transition-handoff plan Task 1):
 * `agent` normally, `finalize`(mapped from END) when the executor appended a
 * terminal AIMessage with real text, or `handoff` when the batch committed a
 * transition to a hand-off target — the phase that hands off never gets a
 * second model call, so it has no final text for `finalize` to validate;
 * the caller must route `handoff` straight to the subgraph's real END,
 * bypassing `finalize` (phase-subgraph.factory.ts).
 */
export function buildAfterTools(
  handoffTargets: ReadonlySet<ConversationPhase> = new Set(),
): (state: {
  messages: BaseMessage[];
  pendingTransition?: TransitionRequest | null;
}) => 'agent' | 'handoff' | typeof END {
  return state => {
    if (state.pendingTransition && handoffTargets.has(state.pendingTransition.toPhase)) {
      return 'handoff';
    }
    const last = state.messages[state.messages.length - 1] as Partial<BaseMessage> | undefined;
    return last?._getType?.() === 'ai' ? END : 'agent';
  };
}

/** Flag-off default (no hand-off targets) — today's behaviour, byte-for-byte. */
export const afterTools = buildAfterTools();
