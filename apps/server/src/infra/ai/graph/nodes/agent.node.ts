/**
 * The shared agent node (ADR-0013 §4.1/§6, refactor-p3-phase-spec Task 2):
 * loads the phase's data, renders its prompt, assembles the context, calls
 * the model, applies the post-tool nudge and the empty-reply retry, and
 * falls back to a catalog message. Identical for every phase — layout,
 * prompt, tools, policy and loaders all come from the PhaseSpec.
 */
import { AIMessage, type BaseMessage, SystemMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import { assembleContext } from '@infra/ai/context/assemble-context';
import type { ConversationGraphDeps, PhaseSpec, PromptContextFor } from '@infra/ai/graph/phase-spec';
import { ctxOf } from '@infra/ai/graph/state';
import { langOf, t } from '@infra/ai/messages';
import { getModel } from '@infra/ai/model.factory';
import { POST_TOOL_NUDGE_V1, renderBlock } from '@infra/ai/prompts/blocks';
import { compose } from '@infra/ai/prompts/compose';

import { createLogger } from '@shared/logger';

const log = createLogger('agent-node');

/** The slice of ConversationState the agent node reads. */
export interface AgentNodeState {
  messages?: BaseMessage[];
  activeSessionId?: string | null;
}

/** Splits the run's messages into the user message and the in-flight tail (Task 3 Step 3 split). */
export function splitUserMessage(messages: BaseMessage[]): { userMessage: string; inFlight: BaseMessage[] } {
  const [first] = messages;
  if (first !== undefined && first._getType() === 'human') {
    const text = typeof first.content === 'string' ? first.content : '';
    return { userMessage: text, inFlight: messages.slice(1) };
  }
  return { userMessage: '', inFlight: [...messages] };
}

function isEmptyAIResponse(response: AIMessage): boolean {
  const emptyContent =
    (typeof response.content === 'string' && response.content.trim().length === 0) ||
    (Array.isArray(response.content) && response.content.length === 0);
  const noToolCalls = !Array.isArray(response.tool_calls) || response.tool_calls.length === 0;
  return emptyContent && noToolCalls;
}

/** Duck-typed (_getType, not instanceof): jest.resetModules re-evaluates @langchain/core. */
function typeOf(m: BaseMessage | undefined): string {
  return (m as { _getType?: () => string } | undefined)?._getType?.() ?? '';
}

function endsWithToolMessage(messages: BaseMessage[]): boolean {
  return typeOf(messages[messages.length - 1]) === 'tool';
}

/**
 * Appends a system-level nudge before the last ToolMessage so the model
 * understands it must produce a text reply — not call another tool, not stay
 * silent. Inserted as SystemMessage (not HumanMessage) to avoid the model
 * echoing it.
 */
function withPostToolNudge(messages: BaseMessage[]): BaseMessage[] {
  const nudge = new SystemMessage(renderBlock(POST_TOOL_NUDGE_V1, {}));
  let lastToolIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (typeOf(messages[i]) === 'tool') {
      lastToolIdx = i;
      break;
    }
  }
  if (lastToolIdx < 0) {
    return [...messages, nudge];
  }
  return [...messages.slice(0, lastToolIdx), nudge, ...messages.slice(lastToolIdx)];
}

export function buildAgentNode<D>(spec: PhaseSpec<D>, deps: ConversationGraphDeps) {
  const { contextService } = deps;

  return async (state: AgentNodeState, config: RunnableConfig): Promise<{ messages: BaseMessage[] }> => {
    const ctx = ctxOf(config as never);
    const { userId, user, now } = ctx;
    const { userMessage, inFlight } = splitUserMessage(state.messages ?? []);

    const [history, previousSummary] = await Promise.all([
      contextService.getMessagesForPrompt(userId, spec.name),
      spec.layout.summaryFrame ? contextService.getLatestSummary(userId) : null,
    ]);
    const lang = langOf(user?.languageCode);

    const loaded = await spec.loadContext({ userId, user, activeSessionId: state.activeSessionId ?? null }, deps);
    if (!loaded.ok) {
      // D-B: phase data guards are catalog replies — no model call.
      return { messages: [new AIMessage(t(loaded.reply, lang))] };
    }

    const systemPrompt = compose(
      spec.prompt.current.render({
        now,
        timezone: user?.timezone ?? null,
        client: 'telegram',
        user,
        ...loaded.data,
      } as PromptContextFor<D>),
    );

    // Dynamic tool filtering (BUG-008 Plan A): names the model may call now;
    // null = all. The policy owns the rule.
    const available = spec.toolPolicy.availability?.({ data: loaded.data }) ?? null;
    const tools = available === null ? spec.tools : spec.tools.filter(tool => available.includes(tool.name));
    if (tools.length < spec.tools.length) {
      const removed = spec.tools.filter(tool => !tools.includes(tool)).map(tool => tool.name);
      log.debug({ userId, phase: spec.name, removed }, 'Dynamic tools: restricted unavailable tools');
    }

    // Pass the node's LangGraph config through so the LLM callback handler sees
    // metadata.runId (run metrics) and metadata.userId (debug logs) — metadata is
    // inherited from the route's invoke config; configurable never reaches handlers.
    const model = getModel(spec.modelProfile).bindTools(tools);

    const { messages: llmMessages, budgetReport } = assembleContext(
      {
        systemPrompt,
        previousSummary,
        history,
        userMessage,
        inFlight,
      },
      spec.layout,
    );
    ctx.metrics.attachBudgetReport(budgetReport);

    // Post-tool nudge + empty-reply retry, moved verbatim from invokeWithRetry
    // (ADR-0013 §6: every phase, one retry, then the catalog fallback — D-D).
    const postTool = endsWithToolMessage(llmMessages);
    const firstMessages = postTool ? withPostToolNudge(llmMessages) : llmMessages;
    const response = await model.invoke(firstMessages, config);

    if (isEmptyAIResponse(response)) {
      log.warn({ userId, phase: spec.name }, 'LLM returned empty response — retrying once');
      // On retry always include the nudge regardless of message structure
      const retryMessages = postTool ? firstMessages : withPostToolNudge(llmMessages);
      const retried = await model.invoke(retryMessages, config);
      if (isEmptyAIResponse(retried)) {
        return { messages: [new AIMessage(t('empty_reply', lang))] };
      }
      return { messages: [retried] };
    }

    return { messages: [response] };
  };
}
