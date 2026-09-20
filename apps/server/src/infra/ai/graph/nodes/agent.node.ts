/**
 * The shared agent node (ADR-0013 §4.1/§6, refactor-p3-phase-spec Task 2):
 * loads the phase's data, renders its prompt, assembles the context, calls
 * the model, applies the post-tool nudge and the empty-reply retry, and
 * falls back to a catalog message. Identical for every phase — layout,
 * prompt, tools, policy and loaders all come from the PhaseSpec.
 */
import { AIMessage, type BaseMessage, SystemMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import type { StoredEpisodeSummary } from '@domain/conversation/episode';

import { assembleContext } from '@infra/ai/context/assemble-context';
import type { StoredCourseDirective } from '@infra/ai/course-check/directive';
import { splitEpisode } from '@infra/ai/graph/episode';
import type { ConversationGraphDeps, PhaseSpec, PromptContextFor } from '@infra/ai/graph/phase-spec';
import { ctxOf } from '@infra/ai/graph/state';
import { langOf, t } from '@infra/ai/messages';
import { getModel } from '@infra/ai/model.factory';
import { POST_TOOL_NUDGE_V1, renderBlock, TIME_GAP_V1 } from '@infra/ai/prompts/blocks';
import { compose } from '@infra/ai/prompts/compose';

import { loadConfig } from '@config/index';

import { createLogger } from '@shared/logger';

const log = createLogger('agent-node');

/** The slice of ConversationState the agent node reads. */
export interface AgentNodeState {
  messages?: BaseMessage[];
  activeSessionId?: string | null;
  /** BR-LLM-001's clock input and the greeting directive's input (D-M — every phase). */
  lastUserMessageAt?: string | null;
  /** Read by the episode-summaries block from Task 5 on (declared now, D-H's state contract). */
  episodeSummaries?: StoredEpisodeSummary[];
  /** AC-FL-5: the persisted course-check directive — prepare's step wrote it; its payload renders as block 2a′. */
  courseDirective?: StoredCourseDirective | null;
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

/** Z.AI/LangChain put the OpenAI finish_reason here (stop | tool_calls | length | …). */
function finishReasonOf(response: AIMessage): string | undefined {
  const meta = response.response_metadata as { finish_reason?: string } | undefined;
  return meta?.finish_reason;
}

/** Token counts: LangChain's usage_metadata, or response_metadata.tokenUsage (OpenAI shape). */
function tokenUsageOf(response: AIMessage): { promptTokens?: number; completionTokens?: number } {
  const um = response.usage_metadata;
  if (um && typeof um.input_tokens === 'number') {
    return { promptTokens: um.input_tokens, completionTokens: um.output_tokens };
  }
  const tu = (response.response_metadata as { tokenUsage?: { promptTokens?: number; completionTokens?: number } })
    ?.tokenUsage;
  return { promptTokens: tu?.promptTokens, completionTokens: tu?.completionTokens };
}

/**
 * BUG-019 / AC-RL-2: every model response is visible at info — one line per
 * call with the finish reason and token counts, never the message bodies.
 * A `length` response additionally warns: the answer was cut off by the
 * output-token cap, a call we already know is dead. Returns the finish reason
 * so the caller can skip the retry (see below).
 */
function logModelResponse(response: AIMessage, userId: string, phase: string): string | undefined {
  const finishReason = finishReasonOf(response);
  const { promptTokens, completionTokens } = tokenUsageOf(response);
  log.info({ userId, phase, finishReason, promptTokens, completionTokens }, 'LLM response');
  if (finishReason === 'length') {
    log.warn(
      { userId, phase, finishReason, completionTokens, maxTokens: loadConfig().LLM_MAX_TOKENS },
      'LLM answer truncated by the output-token cap (finish_reason=length)',
    );
  }
  return finishReason;
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
  return async (state: AgentNodeState, config: RunnableConfig): Promise<{ messages: BaseMessage[] }> => {
    const ctx = ctxOf(config as never);
    const { userId, user, now } = ctx;
    // D-I: this run = the messages from the LAST HumanMessage on; everything
    // before it is episode history from the checkpointed channel itself.
    const { history, current } = splitEpisode(state.messages ?? []);
    const lang = langOf(user?.languageCode);

    const loaded = await spec.loadContext({ userId, user, activeSessionId: state.activeSessionId ?? null }, deps);
    if (!loaded.ok) {
      // D-B: phase data guards are catalog replies — no model call.
      return { messages: [new AIMessage(t(loaded.reply, lang))] };
    }

    const lastMessageTime = state.lastUserMessageAt ? new Date(state.lastUserMessageAt) : null;
    // AC-CC-2 (chat-continuity Task 2): when the new message arrives after an
    // EPISODE_GAP_HOURS pause, one time-gap note sits immediately before it —
    // the SAME threshold compaction's inactivity trigger uses, threaded from
    // the episode config (never re-read from env). `lastUserMessageAt` still
    // holds the previous run's time here; commit.node stamps the new one
    // after the run, and compaction never clears it.
    const gapMs = lastMessageTime !== null ? now.getTime() - lastMessageTime.getTime() : null;
    const gapNote = gapMs !== null && gapMs >= deps.episodeConfig.gapMs ? renderBlock(TIME_GAP_V1, { gapMs }) : null;
    const systemPrompt = compose(
      spec.prompt.current.render({
        now,
        timezone: user?.timezone ?? null,
        client: 'telegram',
        user,
        lastMessageTime,
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

    // P6 Task 4 (D-F): facts are loaded once per run here, not per block
    // render — the block itself is pure and takes already-loaded data. AC-FL-1:
    // the run clock (ctx.now) decides what is expired — never the DB clock.
    const userFacts = await deps.userFacts.getForPrompt(userId, now);

    // ADR-0013 §3.4 block 2a (D-F) + block 3 (D-A/D-B) + INV-LLM-004 (Task 3,
    // order extended by Task 4): assembleContext renders spec.contextBlocks at
    // full depth and enforces the budget via resolveBudget — truncate facts,
    // trim history, step blocks down their depths, drop the oldest summary,
    // D-D floor, in that order. Block 1 (systemPrompt) is never touched here.
    const { messages: llmMessages, budgetReport } = await assembleContext({
      systemPrompt,
      userFacts,
      // AC-FL-5: the directive the course-check step stored (or kept) in
      // prepare this run — its payload, rendered as one block after the facts.
      courseDirective: state.courseDirective?.directive ?? null,
      episodeSummaries: state.episodeSummaries ?? [],
      contextBlocks: spec.contextBlocks,
      blockData: loaded.data,
      history,
      current,
      gapNote,
      budget: spec.budget,
      now,
      timezone: user?.timezone ?? null,
      user,
    });
    ctx.metrics.attachBudgetReport(budgetReport);

    if (budgetReport.system > spec.budget.system) {
      log.warn(
        { userId, phase: spec.name, system: budgetReport.system, budget: spec.budget.system },
        'Phase system prompt exceeds its token budget (reported, never cut — INV-LLM-004)',
      );
    }
    if (budgetReport.cuts?.includes('floor')) {
      log.error(
        { userId, phase: spec.name, cuts: budgetReport.cuts },
        'Context budget hit the floor (D-D) — history and summaries dropped for this run',
      );
    }

    // Post-tool nudge + empty-reply retry, moved verbatim from invokeWithRetry
    // (ADR-0013 §6: every phase, one retry, then the catalog fallback — D-D).
    const postTool = endsWithToolMessage(llmMessages);
    const firstMessages = postTool ? withPostToolNudge(llmMessages) : llmMessages;
    const response = await model.invoke(firstMessages, config);
    const finishReason = logModelResponse(response, userId, spec.name);

    if (isEmptyAIResponse(response)) {
      // BUG-019 / AC-RL-2: an empty answer truncated by the output cap is a
      // call we already know was cut off — never pay a second multi-minute
      // invoke for it; the user gets the catalog text right away.
      if (finishReason === 'length') {
        return { messages: [new AIMessage(t('empty_reply', lang))] };
      }
      log.warn({ userId, phase: spec.name }, 'LLM returned empty response — retrying once');
      // On retry always include the nudge regardless of message structure
      const retryMessages = postTool ? firstMessages : withPostToolNudge(llmMessages);
      const retried = await model.invoke(retryMessages, config);
      logModelResponse(retried, userId, spec.name);
      if (isEmptyAIResponse(retried)) {
        return { messages: [new AIMessage(t('empty_reply', lang))] };
      }
      return { messages: [retried] };
    }

    return { messages: [response] };
  };
}
