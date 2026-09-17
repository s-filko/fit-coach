/**
 * The ConversationRunPort adapter (ADR-0013 §11, D-A): loads the user, builds
 * the immutable run context (runId, user, now, client, trigger, metrics) and
 * invokes the graph. Failed runs get a run row (D-F) and rethrow — error
 * MAPPING itself is P5.
 */
import { randomUUID } from 'node:crypto';

import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { HumanMessage } from '@langchain/core/messages';

import type {
  ConversationRunPort,
  ConversationRunRecord,
  IConversationRunService,
  RunInput,
  RunResult,
} from '@domain/conversation/ports';
import type { IUserService } from '@domain/user/ports';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import { createLogger } from '@shared/logger';

const log = createLogger('conversation-run-adapter');

/** Provider/network failures the OpenAI client throws — outcome 'llm_unavailable' (D-F). */
function isProviderError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return typeof status === 'number' && (status === 429 || status >= 500);
}

export interface ConversationRunnerDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graph: { invoke(input: unknown, config?: unknown): Promise<any> };
  userService: IUserService;
  runService: IConversationRunService;
  /** Extra LangChain callbacks for the run (evals' ToolRecorder) — infra-only surface. */
  extraCallbacks?: BaseCallbackHandler[];
}

export function buildConversationRunner(deps: ConversationRunnerDeps): ConversationRunPort {
  const { graph, userService, runService, extraCallbacks } = deps;

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
        )) as { phase: RunResult['phase'] };

        return {
          // P3: the reply text rides the collector until P4 stops clearing messages
          text: metrics.finalText ?? '',
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
        throw err;
      }
    },
  };
}
