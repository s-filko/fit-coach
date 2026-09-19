/**
 * The ConversationRunPort adapter (ADR-0013 §11, D-A): loads the user, builds
 * the immutable run context (runId, user, now, client, trigger, metrics) and
 * invokes the graph. Failed runs get a run row (D-F) and rethrow — as a typed
 * error (P5 has landed, ADR-0013 §6): `isProviderError` → `LlmUnavailableError`
 * (503), anything else → `CoreError` (500). The original error stays on
 * `cause` for the log only — `chat.routes.ts` never sees it (INV-LLM-006).
 *
 * NOT implemented (owner escalation, P5 Task 3, 2026-09-19): ADR-0013 §6
 * maps a tool `system_error` to a raised `ToolSystemError` → `CoreError` →
 * HTTP 500 with no body internals. The tool executor
 * (`infra/ai/graph/tool-executor.ts:189-195`) does not raise — on a
 * `system_error` it still appends the localized `tool_system_error` catalog
 * message (ru/en) and the run finalizes normally as HTTP 200, exactly as it
 * did before this plan (the `D-D keeps HTTP 200 until P5` comment there
 * predates this decision). Making the executor raise here would turn that
 * 200-with-an-explanation into a 500-with-nothing — a user-visible
 * regression, not a refactor — so it is deliberately left alone and escalated
 * to the owner rather than decided unilaterally. `TOOL_OUTCOME_FORMAT_ID`,
 * the `SYSTEM_ERROR:` prefix and the skip-remaining-batch behaviour in the
 * executor are all untouched by this plan.
 */
import { randomUUID } from 'node:crypto';

import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { type BaseMessage, HumanMessage } from '@langchain/core/messages';

import {
  type ConversationPhase,
  type ConversationRunPort,
  type ConversationRunRecord,
  CoreError,
  type IConversationRunService,
  LlmUnavailableError,
  type RunInput,
  type RunResult,
  type TranscriptPort,
} from '@domain/conversation/ports';
import type { IUserService } from '@domain/user/ports';

import { runAiText } from '@infra/ai/graph/episode';
import { langOf, t } from '@infra/ai/messages';
import { RunMetricsCollector } from '@infra/ai/run-metrics';

import { createLogger } from '@shared/logger';

const log = createLogger('conversation-run-adapter');

/** Provider/network failures the OpenAI client throws — outcome 'llm_unavailable' (D-F). */
function isProviderError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return typeof status === 'number' && (status === 429 || status >= 500);
}

/**
 * Typed rethrow (ADR-0013 §6, INV-LLM-006): the route maps this to an HTTP
 * status and a body carrying only `code`. `err` rides `cause` for the log
 * (`req.log.error({ err })` still sees the real message) — never the message
 * on the thrown error itself.
 */
function toConversationError(err: unknown): LlmUnavailableError | CoreError {
  return isProviderError(err) ? new LlmUnavailableError(undefined, err) : new CoreError(undefined, err);
}

export interface ConversationRunnerDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graph: { invoke(input: unknown, config?: unknown): Promise<any> };
  userService: IUserService;
  runService: IConversationRunService;
  /** D-F: clearContext deletes the thread through the checkpointer. */
  checkpointer: { deleteThread(threadId: string): Promise<void> };
  /** D-F: clearContext leaves a catalog system note in the transcript. */
  transcript: TranscriptPort;
  /** Extra LangChain callbacks for the run (evals' ToolRecorder) — infra-only surface. */
  extraCallbacks?: BaseCallbackHandler[];
}

export function buildConversationRunner(deps: ConversationRunnerDeps): ConversationRunPort {
  const { graph, userService, runService, checkpointer, transcript, extraCallbacks } = deps;

  return {
    async run(input: RunInput): Promise<RunResult> {
      const user = await userService.getUser(input.userId);
      if (!user) {
        throw new Error(`User ${input.userId} not found`);
      }

      const runId = randomUUID();
      const metrics = new RunMetricsCollector(runId);
      const ctx = {
        runId,
        userId: input.userId,
        user,
        now: new Date(),
        client: input.client ?? 'telegram',
        trigger: input.trigger ?? 'user_message',
        metrics,
      };

      try {
        const result = (await graph.invoke(
          { messages: [new HumanMessage(input.text)] },
          {
            configurable: { thread_id: input.userId },
            metadata: { runId, userId: input.userId },
            context: ctx,
            callbacks: [metrics.handler(), ...(extraCallbacks ?? [])],
            recursionLimit: 50,
          },
        )) as { phase: RunResult['phase']; messages: BaseMessage[] };

        return {
          // AC-CC-3 (chat-continuity Task 3): the reply is EVERY non-empty AI
          // text of this run, in order — text written alongside tool calls is
          // delivered too; earlier runs' texts are never re-sent (ADR-0013
          // §3.2 amended at close-out).
          text: runAiText(result.messages ?? []),
          phase: result.phase,
          runId,
        };
      } catch (err) {
        // Best-effort failed-run row (D-F): AC-1301's "one row per POST" becomes true.
        try {
          let phaseIn: ConversationRunRecord['phaseIn'] = 'chat';
          try {
            const st = await (
              graph as { getState?: (c: unknown) => Promise<{ values?: { phase?: ConversationRunRecord['phaseIn'] } }> }
            ).getState?.({ configurable: { thread_id: input.userId } });
            if (st?.values?.phase) {
              phaseIn = st.values.phase;
            }
          } catch {
            // state read is best-effort
          }
          const record: ConversationRunRecord = {
            runId,
            userId: input.userId,
            phaseIn,
            phaseOut: null,
            trigger: ctx.trigger,
            client: ctx.client,
            model: metrics.snapshot().model,
            promptVersions: {},
            tokensIn: null,
            tokensOut: null,
            latencyMs: metrics.snapshot().latencyMs,
            toolCalls: null,
            transition: null,
            outcome: isProviderError(err) ? 'llm_unavailable' : 'core_error',
            budgetReport: null,
          };
          await runService.recordRun(record);
        } catch (recordErr) {
          log.error({ err: recordErr, runId }, 'Failed to record the failed run');
        }
        throw toConversationError(err);
      }
    },

    /** D-F: delete the thread, note it in the transcript — nothing else. */
    async clearContext(userId: string): Promise<void> {
      // The note's phase = the thread's last phase — read before the thread is gone.
      let phase: ConversationPhase = 'chat';
      try {
        const st = await (
          graph as { getState?: (c: unknown) => Promise<{ values?: { phase?: ConversationPhase } }> }
        ).getState?.({ configurable: { thread_id: userId } });
        const { phase: lastPhase } = st?.values ?? {};
        if (lastPhase) {
          phase = lastPhase;
        }
      } catch {
        // best-effort — the default phase carries the note
      }
      const user = await userService.getUser(userId);
      const { languageCode } = user ?? { languageCode: null as string | null };
      const lang = langOf(languageCode);
      await checkpointer.deleteThread(userId);
      await transcript.appendSystemNote({ userId, phase, text: t('context_cleared', lang) });
      log.info({ userId, phase }, 'Context cleared');
    },
  };
}
