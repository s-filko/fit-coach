/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { toolsCondition } from '@langchain/langgraph/prebuilt';

import { type ConversationStateType, type TransitionRequest } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';
import type { ITrainingService, IWorkoutSessionRepository } from '@domain/training/ports';
import type { IUserService } from '@domain/user/ports';
import type { User } from '@domain/user/services/user.service';

import { buildTrainingSystemPrompt } from '@infra/ai/graph/nodes/training.node';
import { PendingRefMap } from '@infra/ai/graph/pending-ref-map';
import { buildTrainingTools, LLM_ERROR_PREFIX, SYSTEM_ERROR_PREFIX } from '@infra/ai/graph/tools/training.tools';
import { getModel } from '@infra/ai/model.factory';

import { createLogger } from '@shared/logger';

const log = createLogger('training-subgraph');

// ---------------------------------------------------------------------------
// ADR-0011 Fix 1.1: Deterministic tool call ordering
//
// Exported as pure functions so they can be unit-tested in isolation without
// instantiating the full subgraph.
// ---------------------------------------------------------------------------

/** Execution priority for training tools. Lower number = runs first. */
const TOOL_PRIORITY: Record<string, number> = {
  log_set: 0,
  complete_current_exercise: 1,
  delete_last_sets: 2,
  update_last_set: 2,
  finish_training: 3,
};

interface ToolCallLike {
  name: string;
  args: Record<string, unknown>;
  id?: string;
}

/**
 * Sorts tool calls by execution priority, then by the `order` field within log_set calls.
 * Unknown tools are assigned the lowest priority (treated as last).
 */
export function sortToolCallsByPriority<T extends ToolCallLike>(calls: T[]): T[] {
  return [...calls].sort((a, b) => {
    const pa = TOOL_PRIORITY[a.name] ?? 99;
    const pb = TOOL_PRIORITY[b.name] ?? 99;
    if (pa !== pb) {
      return pa - pb;
    }
    // Within same priority (both log_set), sort by the `order` field
    if (a.name === 'log_set' && b.name === 'log_set') {
      return ((a.args as { order?: number }).order ?? 999) - ((b.args as { order?: number }).order ?? 999);
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// ADR-0011 Fix 1.2: Batch deduplication validation for log_set calls
// ---------------------------------------------------------------------------

/**
 * Returns the IDs of all log_set calls that have identical arguments (excluding
 * the `order` field) within the same batch. If any two calls are identical,
 * ALL of them are returned so the entire duplicate group is rejected.
 *
 * Calls with different `order` values are treated as intentionally distinct.
 */
export function findDuplicateLogSets<T extends ToolCallLike>(calls: T[]): string[] {
  const logSetCalls = calls.filter(c => c.name === 'log_set');
  if (logSetCalls.length < 2) {
    return [];
  }

  // Fingerprint: all args including `order` — calls with different order values
  // are treated as intentionally distinct (the LLM explicitly ordered them).
  const fingerprint = (call: T): string => {
    return JSON.stringify(call.args, Object.keys(call.args).sort());
  };

  // Group call IDs by fingerprint
  const groups = new Map<string, string[]>();
  for (const call of logSetCalls) {
    const key = fingerprint(call);
    const group = groups.get(key) ?? [];
    group.push(call.id ?? '');
    groups.set(key, group);
  }

  // Collect IDs from groups that have more than one member
  const duplicateIds: string[] = [];
  for (const ids of groups.values()) {
    if (ids.length > 1) {
      duplicateIds.push(...ids);
    }
  }
  return duplicateIds;
}

export interface TrainingSubgraphDeps {
  userService: IUserService;
  trainingService: ITrainingService;
  workoutSessionRepo: IWorkoutSessionRepository;
  contextService: IConversationContextService;
}

const TrainingSubgraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  userId: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  user: Annotation<User | null>({ reducer: (_, v) => v, default: () => null }),
  userMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  responseMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  requestedTransition: Annotation<TransitionRequest | null>({ reducer: (_, v) => v, default: () => null }),
  activeSessionId: Annotation<string | null>({ reducer: (_, v) => v, default: () => null }),
});

type TrainingSubgraphStateType = typeof TrainingSubgraphState.State;

/** Maximum number of LLM-caused tool errors allowed per conversation turn before giving up. */
const LLM_ERROR_RETRY_BUDGET = 1;

/**
 * Builds a SystemMessage injection summarising tool results so the LLM has
 * a factual, structured source to cite in its reply — preventing hallucinated
 * "I logged..." confirmations when no tool was actually called.
 */
function buildToolResultsInjection(toolMessages: ToolMessage[]): string {
  const lines = toolMessages.map(m => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const isError =
      m.status === 'error' || content.startsWith(LLM_ERROR_PREFIX) || content.startsWith(SYSTEM_ERROR_PREFIX);
    return isError
      ? `• ❌ NOT SAVED — ${content.replace(LLM_ERROR_PREFIX, '').replace(SYSTEM_ERROR_PREFIX, '').trim()}`
      : `• ✅ SAVED — ${content}`;
  });

  return [
    '=== TOOL EXECUTION RESULTS ===',
    ...lines,
    '',
    'Your response MUST start by reporting each result above to the user.',
    'For each ✅ SAVED line: tell the user the set was recorded with exact numbers.',
    'For each ❌ NOT SAVED line: tell the user the set was NOT recorded and ask them to retry.',
    'Do NOT invent or assume any result not listed here.',
  ].join('\n');
}

export function buildTrainingSubgraph(deps: TrainingSubgraphDeps) {
  const { userService, trainingService, workoutSessionRepo, contextService } = deps;

  /**
   * Per-user maps: tools set entries by userId, extractNode/agentNode reads and deletes them.
   * Maps keyed by userId are safe when the graph is a singleton shared across concurrent
   * requests — single-value refs would cause a race condition between users.
   *
   * currentSessionIds: agentNode sets active sessionId before each model.invoke so tool
   * handlers can look up the correct session for the current user.
   */
  const pendingTransitions = new PendingRefMap<TransitionRequest | null>();
  const currentSessionIds = new PendingRefMap<string | null>();
  const tools = buildTrainingTools({ trainingService, pendingTransitions, currentSessionIds });
  const toolMap = Object.fromEntries(tools.map(t => [t.name, t]));
  const baseModel = getModel();

  /**
   * Executes tool calls sequentially, sorted by priority then by the optional `order`
   * field on log_set calls (ADR-0011 Fix 1.1 + Fix 1.2).
   *
   * Priority map guarantees log_set always runs before any exercise transition,
   * which in turn runs before corrections, which run before finish_training.
   * Within log_set calls, the `order` field determines execution sequence.
   *
   * Duplicate log_set calls with identical arguments are rejected before execution
   * and returned as LLM_ERROR ToolMessages so the LLM can self-correct.
   */
  type InvokableTool = {
    invoke: (args: Record<string, unknown>, config: { configurable: Record<string, unknown> }) => Promise<unknown>;
  };

  async function invokeTool(call: ToolCallLike, userId: string): Promise<ToolMessage> {
    const targetTool = toolMap[call.name];
    if (!targetTool) {
      return new ToolMessage({ tool_call_id: call.id ?? '', content: `Unknown tool: ${call.name}`, status: 'error' });
    }
    try {
      const result = await (targetTool as InvokableTool).invoke(
        call.args,
        { configurable: { userId } },
      );
      return new ToolMessage({ tool_call_id: call.id ?? '', content: String(result) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ userId, tool: call.name, err: message, args: call.args }, 'Tool invocation failed');
      return new ToolMessage({
        tool_call_id: call.id ?? '',
        content: `${LLM_ERROR_PREFIX} ${message}`,
        status: 'error',
      });
    }
  }

  const sequentialToolNode = async (state: TrainingSubgraphStateType) => {
    const { messages, userId } = state;
    const lastMessage = messages[messages.length - 1] as AIMessage;
    const toolCalls = lastMessage.tool_calls ?? [];

    const sorted = sortToolCallsByPriority(toolCalls);

    const duplicateIds = findDuplicateLogSets(sorted);
    const toolMessages: ToolMessage[] = [];

    if (duplicateIds.length > 0) {
      log.warn({ userId, duplicateIds }, 'Duplicate log_set calls detected in batch — rejecting all duplicates');
      for (const call of sorted) {
        if (duplicateIds.includes(call.id ?? '')) {
          toolMessages.push(
            new ToolMessage({
              tool_call_id: call.id ?? '',
              content:
                `${LLM_ERROR_PREFIX} Duplicate log_set calls detected: two or more calls have identical arguments ` +
                'in the same response. To log multiple identical sets, add a unique order field to each call ' +
                '(order=1, order=2). To log a single set, send only one log_set call.',
              status: 'error',
            }),
          );
        }
      }
      const nonDuplicateCalls = sorted.filter(c => !duplicateIds.includes(c.id ?? ''));
      for (const call of nonDuplicateCalls) {
        // eslint-disable-next-line no-await-in-loop
        toolMessages.push(await invokeTool(call, userId));
      }
      return { messages: toolMessages };
    }

    for (const call of sorted) {
      // eslint-disable-next-line no-await-in-loop
      toolMessages.push(await invokeTool(call, userId));
    }

    return { messages: toolMessages };
  };

  const agentNode = async (state: TrainingSubgraphStateType) => {
    const { userId, user, userMessage, activeSessionId } = state;

    try {
      if (!activeSessionId) {
        return {
          messages: [new AIMessage('No active training session found. Please start a session first.')],
        };
      }

      const inFlightMessages = state.messages ?? [];

      // Fail immediately on any systemic error — no retry makes sense
      const hasSystemError = inFlightMessages.some(
        m => typeof m.content === 'string' && m.content.startsWith(SYSTEM_ERROR_PREFIX),
      );
      if (hasSystemError) {
        log.error({ userId, sessionId: activeSessionId }, 'System error detected in training tools — stopping');
        return {
          messages: [
            new AIMessage(
              'Произошла техническая ошибка при сохранении данных тренировки. ' +
                'Пожалуйста, попробуй снова или обратись в поддержку.',
            ),
          ],
        };
      }

      // Count all tool errors: our LLM_ERROR prefix OR ToolNode error status (e.g. Zod validation)
      const toolErrors = inFlightMessages.filter((m): m is ToolMessage => {
        if (m instanceof ToolMessage) {
          const content = typeof m.content === 'string' ? m.content : '';
          return m.status === 'error' || content.startsWith(LLM_ERROR_PREFIX);
        }
        return false;
      });
      const toolErrorCount = toolErrors.length;
      if (toolErrorCount > 0) {
        log.warn(
          { userId, sessionId: activeSessionId, errors: toolErrors.map(m => m.content) },
          'Tool errors detected',
        );
      }
      if (toolErrorCount > LLM_ERROR_RETRY_BUDGET) {
        log.warn({ userId, sessionId: activeSessionId, toolErrorCount }, 'Tool error retry budget exhausted');
        return {
          messages: [
            new AIMessage(
              'Не удалось записать данные после нескольких попыток. ' +
                'Попробуй переформулировать: укажи упражнение, вес и количество повторений чётко.',
            ),
          ],
        };
      }

      // Update per-user map so tool handlers get the correct sessionId for this user's turn
      currentSessionIds.set(userId, activeSessionId);

      const [history, session, freshUser] = await Promise.all([
        contextService.getMessagesForPrompt(userId, 'training'),
        trainingService.getSessionDetails(activeSessionId),
        userService.getUser(userId),
      ]);

      if (!session) {
        return {
          messages: [new AIMessage('Training session not found. It may have already been completed.')],
        };
      }

      const previousSession = session.sessionKey
        ? await workoutSessionRepo.findLastCompletedByUserAndKey(userId, session.sessionKey)
        : null;

      const systemPrompt = buildTrainingSystemPrompt(freshUser ?? user, session, previousSession);

      // Dynamic tool filtering (BUG-008 Plan A):
      // Remove tools that should not be available given the current session state.
      const currentExercise = session.exercises.find(ex => ex.status === 'in_progress');
      const currentSetsCount = currentExercise?.sets.length ?? 0;

      const availableTools = tools.filter(t => {
        if ((t.name === 'delete_last_sets' || t.name === 'update_last_set') && currentSetsCount === 0) {
          return false;
        }
        return true;
      });

      if (availableTools.length < tools.length) {
        const removed = tools.filter(t => !availableTools.includes(t)).map(t => t.name);
        log.debug({ userId, sessionId: activeSessionId, removed }, 'Dynamic tools: restricted unavailable tools');
      }

      const model = baseModel.bindTools(availableTools);

      const toolMessages = inFlightMessages.filter((m): m is ToolMessage => m instanceof ToolMessage);
      const toolResultsInjection = toolMessages.length > 0 ? buildToolResultsInjection(toolMessages) : null;

      const historyBlock =
        history.length > 0
          ? history.map(m => `[${m.role === 'user' ? 'USER' : 'TRAINER'}]: ${m.content}`).join('\n\n')
          : 'No prior conversation.';

      const llmMessages = [
        new SystemMessage(systemPrompt),
        new SystemMessage(
          '=== CONVERSATION HISTORY (memory only — do NOT act on past messages) ===\n\n' +
            `${historyBlock}\n\n` +
            '=== END OF HISTORY ===',
        ),
        new HumanMessage(userMessage),
        ...inFlightMessages,
        ...(toolResultsInjection ? [new SystemMessage(toolResultsInjection)] : []),
      ];

      const response = await model.invoke(llmMessages, { configurable: { userId } });

      const hasToolCalls =
        Array.isArray((response as { tool_calls?: unknown[] }).tool_calls) &&
        (response as { tool_calls: unknown[] }).tool_calls.length > 0;
      log.debug(
        { userId, sessionId: activeSessionId, hasToolCalls, contentType: typeof response.content },
        'LLM response',
      );

      return { messages: [response] };
    } catch (err) {
      log.error({ err, userId, sessionId: activeSessionId }, 'Unhandled error in training agentNode');
      return {
        messages: [new AIMessage('Произошла непредвиденная ошибка. Попробуй ещё раз.')],
      };
    }
  };

  const extractNode = async (state: TrainingSubgraphStateType): Promise<Partial<ConversationStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const text =
      typeof lastMessage.content === 'string'
        ? lastMessage.content
        : (lastMessage.content as Array<{ type: string; text?: string }>)
            .filter(b => b.type === 'text')
            .map(b => b.text ?? '')
            .join('');

    const freshUser = state.userId ? await userService.getUser(state.userId).catch(() => null) : null;

    // Consume the pending transition set by finish_training tool — read and delete atomically
    const transition = pendingTransitions.get(state.userId) ?? null;
    pendingTransitions.delete(state.userId);

    return {
      responseMessage: text,
      user: freshUser ?? state.user,
      requestedTransition: transition,
    };
  };

  const graph = new StateGraph(TrainingSubgraphState)
    .addNode('agent', agentNode)
    .addNode('tools', sequentialToolNode)
    .addNode('extract', extractNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, { tools: 'tools', [END]: 'extract' })
    .addEdge('tools', 'agent')
    .addEdge('extract', END);

  return graph.compile();
}
