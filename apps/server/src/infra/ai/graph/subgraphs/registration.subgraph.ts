/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { AIMessage, mergeMessageRuns } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { toolsCondition } from '@langchain/langgraph/prebuilt';

import { type ConversationStateType, type TransitionRequest } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService } from '@domain/conversation/ports';
import type { IUserService } from '@domain/user/ports';
import { User } from '@domain/user/services/user.service';

import { assembleContext } from '@infra/ai/context/assemble-context';
import { REGISTRATION_TOOL_POLICY } from '@infra/ai/graph/phases/registration.spec';
import { afterTools, buildToolExecutor } from '@infra/ai/graph/tool-executor';
import { getModel } from '@infra/ai/model.factory';
import { PHASE_PROMPTS } from '@infra/ai/prompts';
import { compose } from '@infra/ai/prompts/compose';
import { REGISTRATION_PROMPT } from '@infra/ai/prompts/phases/registration';
import { attachBudgetReport } from '@infra/ai/run-metrics';
import { buildCompleteRegistrationTool, buildSaveProfileFieldsTool, buildSharedTools } from '@infra/ai/tools';

export interface RegistrationSubgraphDeps {
  userService: IUserService;
  contextService: IConversationContextService;
}

const RegistrationSubgraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  userId: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  user: Annotation<User | null>({ reducer: (_, v) => v, default: () => null }),
  userMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  responseMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  requestedTransition: Annotation<TransitionRequest | null>({ reducer: (_, v) => v, default: () => null }),
});

type RegistrationSubgraphStateType = typeof RegistrationSubgraphState.State;

export function buildRegistrationSubgraph(deps: RegistrationSubgraphDeps) {
  const { userService, contextService } = deps;

  const tools = [
    buildSaveProfileFieldsTool({ userService }),
    buildCompleteRegistrationTool({ userService }),
    ...buildSharedTools({ userService }),
  ];
  const toolNode = buildToolExecutor(tools, REGISTRATION_TOOL_POLICY);
  const model = getModel().bindTools(tools);

  const agentNode = async (state: RegistrationSubgraphStateType, config: RunnableConfig) => {
    const { userId, user, userMessage } = state;

    const history = await contextService.getMessagesForPrompt(userId, 'registration');

    // Fetch fresh user before each LLM call so the prompt reflects tool-saved fields
    const freshUser = await userService.getUser(userId);
    const promptUser = freshUser ?? user;
    const systemPrompt = compose(
      REGISTRATION_PROMPT.current.render({
        now: new Date(),
        timezone: promptUser?.timezone ?? null,
        client: 'telegram',
        user: promptUser,
        lastMessageTime: null,
      }),
    );

    // state.messages holds AIMessage(tool_calls) + ToolMessages from the current turn.
    // These are NOT in DB history yet (persist runs after subgraph finishes).
    // Including them lets the LLM see tool results and stop calling tools.
    const { messages: assembled, budgetReport } = assembleContext(
      {
        systemPrompt,
        history,
        userMessage,
        inFlight: state.messages ?? [],
      },
      PHASE_PROMPTS['registration'].layout,
    );
    // Transitional (deleted with these subgraphs in Task 3): today's merged system
    // runs — the message-assembly snapshots stay byte-identical until Task 3
    // re-points the harness at the shared agent node (ADR-0013 §3.4 unmerges).
    const llmMessages = mergeMessageRuns(assembled);
    attachBudgetReport(config.metadata?.['runId'] as string, budgetReport);

    // Pass the node's LangGraph config through so the LLM callback handler sees
    // metadata.runId (run metrics) and metadata.userId (debug logs) — metadata is
    // inherited from the route's invoke config; configurable never reaches handlers.
    const response = await model.invoke(llmMessages, config);

    return { messages: [response] };
  };

  const extractNode = async (state: RegistrationSubgraphStateType): Promise<Partial<ConversationStateType>> => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const text =
      typeof lastMessage.content === 'string'
        ? lastMessage.content
        : (lastMessage.content as Array<{ type: string; text?: string }>)
            .filter(b => b.type === 'text')
            .map(b => b.text ?? '')
            .join('');

    // Read fresh user from DB to capture any fields saved by tools during this turn
    const freshUser = state.userId ? await userService.getUser(state.userId).catch(() => null) : null;

    // requestedTransition arrives through the subgraph state from the tool executor
    return {
      responseMessage: text,
      user: freshUser ?? state.user,
    };
  };

  const graph = new StateGraph(RegistrationSubgraphState)
    .addNode('agent', agentNode)
    .addNode('tools', toolNode)
    .addNode('extract', extractNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, { tools: 'tools', [END]: 'extract' })
    .addConditionalEdges('tools', afterTools, { agent: 'agent', [END]: 'extract' })
    .addEdge('extract', END);

  return graph.compile();
}
