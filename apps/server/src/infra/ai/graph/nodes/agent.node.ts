/**
 * The shared agent node (ADR-0013 §4.1/§6, refactor-p3-phase-spec Task 2):
 * loads the phase's data, renders its prompt, assembles the context, calls
 * the model, applies the post-tool nudge and the empty-reply retry, and
 * falls back to a catalog message. Identical for every phase — layout,
 * prompt, tools, policy and loaders all come from the PhaseSpec.
 */
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import type { StoredEpisodeSummary } from '@domain/conversation/episode';

import { assembleContext } from '@infra/ai/context/assemble-context';
import { applyCacheBreakpoints, partsOf, withParts } from '@infra/ai/context/cache-breakpoints';
import { warmCacheOf } from '@infra/ai/context/cache-warmth';
import type { CourseCheckDirective, StoredCourseDirective } from '@infra/ai/course-check/directive';
import { splitEpisode, workoutHistory } from '@infra/ai/graph/episode';
import type { ConversationGraphDeps, PhaseSpec, PromptContextFor } from '@infra/ai/graph/phase-spec';
import { ctxOf } from '@infra/ai/graph/state';
import { langOf, t } from '@infra/ai/messages';
import { getModel } from '@infra/ai/model.factory';
import { CURRENT_TIME_V1, POST_TOOL_NUDGE_V1, renderBlock, TIME_GAP_V1, TIME_GAP_V2 } from '@infra/ai/prompts/blocks';
import { compose } from '@infra/ai/prompts/compose';
import { extractUsageFromMessage, stripRawResponse } from '@infra/ai/usage';

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
  /** This run's one-shot expiry questions — rendered with the directive, cleared by commit, never persisted with it. */
  courseExpiryQuestions?: string[];
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

/**
 * BUG-019 / AC-RL-2: every model response is visible at info — one line per
 * call with the finish reason and token counts, never the message bodies.
 * A `length` response additionally warns: the answer was cut off by the
 * output-token cap, a call we already know is dead. Returns the finish reason
 * so the caller can skip the retry (see below).
 *
 * D2: token counts come from the shared extractor (usage.ts) — the same source of truth
 * llm-log-handler.ts/run-metrics.ts use — so this line adds cacheReadTokens/reasoningTokens too.
 */
function logModelResponse(response: AIMessage, userId: string, phase: string): string | undefined {
  const finishReason = finishReasonOf(response);
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens } =
    extractUsageFromMessage(response);
  log.info(
    {
      userId,
      phase,
      finishReason,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      reasoningTokens,
    },
    'LLM response',
  );
  if (finishReason === 'length') {
    log.warn(
      { userId, phase, finishReason, completionTokens: outputTokens, maxTokens: loadConfig().LLM_MAX_TOKENS },
      'LLM answer truncated by the output-token cap (finish_reason=length)',
    );
  }
  return finishReason;
}

/**
 * The request's copy of `message` with `text` appended as one more text part. Only the two roles a nudge can
 * land on are cloned; anything else is returned as is.
 */
function withAppendedText(message: BaseMessage, text: string): BaseMessage {
  const role = typeOf(message);
  return role === 'tool' || role === 'human'
    ? withParts(message, [...partsOf(message), { type: 'text', text }])
    : message;
}

/**
 * Prompt-caching plan D3: the post-tool nudge — the model must produce a text reply, not call another tool and
 * not stay silent — rides as a text part appended to the LAST ToolMessage (after cache breakpoint 2: an uncached
 * tail, never part of the prefix). It is no longer a SystemMessage: OpenRouter hoists every SystemMessage into the
 * single system prompt, so an inserted one changed the whole cached prefix on every post-tool call. With no
 * ToolMessage at all (empty-reply retry after a plain answer) it is appended to the last message instead.
 */
function withPostToolNudge(messages: BaseMessage[]): BaseMessage[] {
  const nudge = renderBlock(POST_TOOL_NUDGE_V1, {});
  let target = messages.length - 1;
  // Only this run's own tool traffic (after the current HumanMessage) can carry it — an older ToolMessage sits
  // inside the cached history prefix and must never change.
  for (let i = messages.length - 1; i >= 0 && typeOf(messages[i]) !== 'human'; i--) {
    if (typeOf(messages[i]) === 'tool') {
      target = i;
      break;
    }
  }
  if (target < 0) {
    return messages;
  }
  return messages.map((m, i) => (i === target ? withAppendedText(m, nudge) : m));
}

export function buildAgentNode<D>(spec: PhaseSpec<D>, deps: ConversationGraphDeps) {
  return async (state: AgentNodeState, config: RunnableConfig): Promise<{ messages: BaseMessage[] }> => {
    const ctx = ctxOf(config as never);
    const { userId, user, now } = ctx;
    // D-I: this run = the messages from the LAST HumanMessage on; everything
    // before it is episode history from the checkpointed channel itself.
    const { history, current } = splitEpisode(state.messages ?? []);
    const lang = langOf(user?.languageCode);

    const loaded = await spec.loadContext({ userId, user, activeSessionId: state.activeSessionId ?? null, now }, deps);
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
    const messageGapMs = gapMs !== null && gapMs >= deps.episodeConfig.gapMs ? gapMs : null;
    let gapNote: string | null = null;
    let gapModule: typeof TIME_GAP_V1 | typeof TIME_GAP_V2 = TIME_GAP_V1;
    if (deps.loadPlanBreaks === true) {
      // load-plan Task 4 (D9): the same note also carries the training-break tier and, once per break, the
      // reason question — one "long time no see" mechanism. Off = v1 exactly.
      if (ctx.trainingBreak === undefined) {
        ctx.trainingBreak = (await deps.breakContext?.resolve(userId, now, user?.timezone ?? null)) ?? null;
      }
      const training = ctx.trainingBreak ?? undefined;
      if (messageGapMs !== null || training?.ask) {
        gapModule = TIME_GAP_V2;
        gapNote = renderBlock(TIME_GAP_V2, { gapMs: messageGapMs, training });
      }
    } else if (messageGapMs !== null) {
      gapNote = renderBlock(TIME_GAP_V1, { gapMs: messageGapMs });
    }
    if (gapNote !== null) {
      // Review R1 (BR-LLM-008): the note reached the request, so the run row
      // must stamp it — `commit` merges these into the row's promptVersions.
      ctx.promptVersionExtras = { [gapModule.id]: gapModule.version };
    }
    // The shared render context (review R2: built once) — the NOW line and the
    // phase prompt render from the same `now`/`timezone`/`user` (BR-LLM-007:
    // pure render, no second read of anything).
    const renderCtx = {
      now,
      timezone: user?.timezone ?? null,
      client: 'telegram' as const,
      user,
      lastMessageTime,
    };
    // now-line-last plan (D2): the NOW line left the directives (block 1 —
    // it changes every minute, so nothing after it was ever prompt-cached)
    // and is rendered here into its own SystemMessage immediately before
    // `current`, following the gap-note wiring. One renderer — CURRENT_TIME_V1
    // (blocks/, a standalone message module like the gap note since review R1)
    // — the same module that used to render it inside block 1.
    const nowLine = renderBlock(CURRENT_TIME_V1, renderCtx);
    const systemPrompt = compose(
      spec.prompt.current.render({
        ...renderCtx,
        ...loaded.data,
      } as PromptContextFor<D>),
    );
    // load-plan plan Task 5b (AC-LP-7): stamp the phase module version actually rendered — with
    // LOAD_PLAN_PLANNER_REBIND the graph renders v11/v5 while the static registry still says
    // v10/v4. `commit` merges these extras over `promptVersionsForPhase`; the value is the same
    // one when the flag is off, so today's run rows do not change.
    ctx.promptVersionExtras = {
      ...ctx.promptVersionExtras,
      [spec.prompt.current.id]: spec.prompt.current.version,
    };

    // Prompt-caching plan D4: every phase tool is always bound, in the spec's stable order — the tool list is the
    // first thing in the request prefix, so hiding a tool mid-session (the old BUG-008 Plan A availability filter)
    // was a full cache miss. Calls that make no sense yet are rejected by the tool itself instead.
    const { tools } = spec;

    // Pass the node's LangGraph config through so the LLM callback handler sees
    // metadata.runId (run metrics) and metadata.userId (debug logs) — metadata is
    // inherited from the route's invoke config; configurable never reaches handlers.
    const model = getModel(spec.modelProfile).bindTools(tools);

    // P6 Task 4 (D-F): facts are loaded once per run here, not per block
    // render — the block itself is pure and takes already-loaded data. AC-FL-1:
    // the run clock (ctx.now) decides what is expired — never the DB clock.
    // coach-simplification I1: a `'workout'` phase (training) renders its own facts through its blocks and
    // system message — no user-facts block, course directive or episode summaries, and only this workout's messages.
    const workoutMemory = spec.memory === 'workout';
    const userFacts = workoutMemory ? [] : await deps.userFacts.getForPrompt(userId, now);

    // ADR-0013 §3.4 block 2a (D-F) + block 3 (D-A/D-B) + INV-LLM-004 (Task 3,
    // order extended by Task 4): assembleContext renders spec.contextBlocks at
    // full depth and enforces the budget via resolveBudget — truncate facts,
    // trim history, step blocks down their depths, drop the oldest summary,
    // D-D floor, in that order. Block 1 (systemPrompt) is never touched here.
    // Prompt-caching plan D5: the cache counts as warm while the user's previous message is younger than the TTL
    // (same source as the compact step: state.lastUserMessageAt, no extra query). Warm → the assembler skips every
    // budget cut unless the estimated total is over the hard cap.
    // (episodeConfig is only read once there is a previous message, like the gap note above.)
    const cacheWarm = warmCacheOf(deps.episodeConfig, state.lastUserMessageAt ?? null, now);
    const {
      messages: assembledMessages,
      budgetReport,
      hardCapExceeded,
    } = await assembleContext({
      systemPrompt,
      userFacts,
      // AC-FL-5: the directive the course-check step stored (or kept) in
      // prepare this run — its payload, rendered as one block after the facts.
      courseDirective: workoutMemory ? null : directiveForRun(state),
      episodeSummaries: workoutMemory ? [] : (state.episodeSummaries ?? []),
      contextBlocks: spec.contextBlocks,
      blockData: loaded.data,
      history: workoutMemory ? workoutHistory(history, current) : history,
      current,
      gapNote,
      nowLine,
      budget: spec.budget,
      cacheWarm,
      now,
      timezone: user?.timezone ?? null,
      user,
    });
    ctx.metrics.attachBudgetReport(budgetReport);
    if (hardCapExceeded) {
      ctx.metrics.declareCacheBreak('hard_cap'); // D8.1 — the assembler cut the cached prefix anyway
      log.info(
        {
          userId,
          phase: spec.name,
          estimatedTotal: hardCapExceeded.estimatedTotalTokens,
          cap: hardCapExceeded.hardCapTokens,
        },
        'Context hard cap reached while cache warm',
      );
    }

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

    // Prompt-caching plan D1/D6: the two explicit breakpoints, only when the route is configured for them; with
    // `off` the request stays exactly what assembleContext built.
    const cfg = loadConfig();
    const llmMessages =
      cfg.LLM_PROMPT_CACHE === 'anthropic'
        ? applyCacheBreakpoints(assembledMessages, current.length, cfg.LLM_PROMPT_CACHE_TTL)
        : assembledMessages;

    // Prompt-caching plan D8: the run's declared cache-break reasons and the phase ride on the call's callback
    // metadata (read fresh per call — nodes declare reasons as the run goes), so the recorder can classify the call.
    const callConfig = (): RunnableConfig => ({
      ...config,
      metadata: { ...config.metadata, phase: spec.name, cacheBreakReasons: ctx.metrics.declaredCacheBreaks() },
    });

    // Post-tool nudge + empty-reply retry, moved verbatim from invokeWithRetry
    // (ADR-0013 §6: every phase, one retry, then the catalog fallback — D-D).
    const postTool = endsWithToolMessage(llmMessages);
    const firstMessages = postTool ? withPostToolNudge(llmMessages) : llmMessages;
    const response = await model.invoke(firstMessages, callConfig());
    const finishReason = logModelResponse(response, userId, spec.name);
    stripRawResponse(response);

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
      const retried = await model.invoke(retryMessages, callConfig());
      logModelResponse(retried, userId, spec.name);
      stripRawResponse(retried);
      if (isEmptyAIResponse(retried)) {
        return { messages: [new AIMessage(t('empty_reply', lang))] };
      }
      return { messages: [retried] };
    }

    return { messages: [response] };
  };
}

/**
 * The directive as THIS run renders it: the stored one, plus the expiry
 * questions asked this run (course-check expiry) appended to its questions. The
 * stored directive never carries them — they are one-shot.
 */
function directiveForRun(state: AgentNodeState): CourseCheckDirective | null {
  const stored = state.courseDirective?.directive;
  if (stored === undefined) {
    return null;
  }
  const oneShot = state.courseExpiryQuestions ?? [];
  return oneShot.length === 0 ? stored : { ...stored, questions: [...stored.questions, ...oneShot] };
}
