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
        // A schema rejection carries no recovery cue unless we add one: ids are
        // UUIDs the model must copy verbatim from search_exercises results
        // (dev-smoke 2026-09-17: the model invented exerciseIds and gave up).
        if (message.includes('did not match expected schema')) {
          message += `\nFix the arguments and call ${call.name} again: every id must be a UUID copied verbatim from the search_exercises results (the "ID:..." line), never invented or abbreviated.`;
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

/** Conditional edge after the executor: 'agent' normally, END when the executor appended a terminal AIMessage. */
export function afterTools(state: { messages: BaseMessage[] }): 'agent' | typeof END {
  const last = state.messages[state.messages.length - 1] as Partial<BaseMessage> | undefined;
  return last?._getType?.() === 'ai' ? END : 'agent';
}
