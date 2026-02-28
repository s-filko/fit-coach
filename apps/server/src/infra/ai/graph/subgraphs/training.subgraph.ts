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
import { buildTrainingTools, LLM_ERROR_PREFIX, SYSTEM_ERROR_PREFIX } from '@infra/ai/graph/tools/training.tools';
import { getModel } from '@infra/ai/model.factory';

import { createLogger } from '@shared/logger';

const log = createLogger('training-subgraph');

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
  const lines = toolMessages.map((m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const isError = m.status === 'error' || content.startsWith(LLM_ERROR_PREFIX) || content.startsWith(SYSTEM_ERROR_PREFIX);
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
   * pendingTransition: finish_training writes here, extractNode reads and clears.
   * currentSessionId: agentNode writes active sessionId before each model.invoke so tool
   * handlers can read it via closure without relying on ToolNode configurable (which only
   * propagates config from the root graph.invoke, not from model.invoke).
   */
  const pendingTransition: { value: TransitionRequest | null } = { value: null };
  const currentSessionId: { value: string | null } = { value: null };
  const tools = buildTrainingTools({ trainingService, pendingTransition, currentSessionId });
  const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]));
  const model = getModel().bindTools(tools);

  /**
   * Executes tool calls sequentially, sorted by the optional `order` field on log_set calls.
   * This replaces the prebuilt ToolNode (which uses Promise.all) to guarantee that when
   * multiple log_set calls are made in one LLM response, they run in the declared order —
   * ensuring correct set_number assignment and preserving semantic distinction between sets
   * (e.g. warmup → main → finishing).
   */
  const sequentialToolNode = async (state: TrainingSubgraphStateType) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1] as AIMessage;
    const toolCalls = lastMessage.tool_calls ?? [];

    const sorted = [...toolCalls].sort((a, b) => {
      if (a.name !== 'log_set' || b.name !== 'log_set') { return 0; }
      return ((a.args as { order?: number }).order ?? 999) - ((b.args as { order?: number }).order ?? 999);
    });

    const toolMessages: ToolMessage[] = [];
    for (const call of sorted) {
      const targetTool = toolMap[call.name];
      if (!targetTool) {
        toolMessages.push(new ToolMessage({
          tool_call_id: call.id ?? '',
          content: `Unknown tool: ${call.name}`,
          status: 'error',
        }));
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const result = await (targetTool as { invoke: (args: Record<string, unknown>) => Promise<unknown> })
        .invoke(call.args as Record<string, unknown>);
      toolMessages.push(new ToolMessage({
        tool_call_id: call.id ?? '',
        content: String(result),
      }));
    }

    return { messages: toolMessages };
  };

  const agentNode = async(state: TrainingSubgraphStateType) => {
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
        (m) => typeof m.content === 'string' && m.content.startsWith(SYSTEM_ERROR_PREFIX),
      );
      if (hasSystemError) {
        log.error({ userId, sessionId: activeSessionId }, 'System error detected in training tools — stopping');
        return {
          messages: [new AIMessage(
            'Произошла техническая ошибка при сохранении данных тренировки. ' +
            'Пожалуйста, попробуй снова или обратись в поддержку.',
          )],
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
        log.warn({ userId, sessionId: activeSessionId, errors: toolErrors.map((m) => m.content) }, 'Tool errors detected');
      }
      if (toolErrorCount > LLM_ERROR_RETRY_BUDGET) {
        log.warn({ userId, sessionId: activeSessionId, toolErrorCount }, 'Tool error retry budget exhausted');
        return {
          messages: [new AIMessage(
            'Не удалось записать данные после нескольких попыток. ' +
            'Попробуй переформулировать: укажи упражнение, вес и количество повторений чётко.',
          )],
        };
      }

      // Update closure ref so tool handlers get the correct sessionId for this turn
      currentSessionId.value = activeSessionId;

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

      // Build tool results summary injection — only when there are ToolMessages in flight.
      // This gives the LLM a guaranteed factual statement to reference in its response,
      // preventing hallucinated "I logged..." confirmations.
      const toolMessages = inFlightMessages.filter((m): m is ToolMessage => m instanceof ToolMessage);
      const toolResultsInjection = toolMessages.length > 0
        ? buildToolResultsInjection(toolMessages)
        : null;

      const historyBlock = history.length > 0
        ? history.map((m) => `[${m.role === 'user' ? 'USER' : 'TRAINER'}]: ${m.content}`).join('\n\n')
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

      const hasToolCalls = Array.isArray((response as { tool_calls?: unknown[] }).tool_calls)
        && (response as { tool_calls: unknown[] }).tool_calls.length > 0;
      log.debug({ userId, sessionId: activeSessionId, hasToolCalls, contentType: typeof response.content }, 'LLM response');

      return { messages: [response] };
    } catch (err) {
      log.error({ err, userId, sessionId: activeSessionId }, 'Unhandled error in training agentNode');
      return {
        messages: [new AIMessage('Произошла непредвиденная ошибка. Попробуй ещё раз.')],
      };
    }
  };

  const extractNode = async(state: TrainingSubgraphStateType): Promise<Partial<ConversationStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const text = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : (lastMessage.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('');

    const freshUser = state.userId
      ? await userService.getUser(state.userId).catch(() => null)
      : null;

    const transition = pendingTransition.value;
    pendingTransition.value = null;

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
