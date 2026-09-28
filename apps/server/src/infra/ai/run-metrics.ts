/**
 * Per-run LLM metrics (ADR-0013 §8), refactor-p3-run-context-commit Task 3:
 * a per-run `RunMetricsCollector` lives in run context; its callback handler
 * is passed in the invoke config (callbacks are inherited by nested runs, so
 * every model call of the run reports to it). The P0 module-level maps are
 * gone — no shared mutable state (AC-1331).
 *
 * `latencyMs` is wall time from the collector's construction (the adapter,
 * before the graph runs) to `snapshot()` — the end-to-end run latency P5.2
 * calibrates `requestTimeout` against.
 */
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';

import type { BudgetReport } from '@domain/conversation/ports';

import { extractUsageFromLLMResult, type UsageMetadataLike } from './usage';

export interface RunMetrics {
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  /** AC-CA-2: sums of the run's own calls' cache_read/reasoning — null when none reported them, never 0. */
  tokensCached: number | null;
  tokensReasoning: number | null;
  latencyMs: number;
  llmCalls: number;
  budgetReport: BudgetReport | null;
  assemblies: number;
}

export class RunMetricsCollector {
  private model: string | null = null;
  private tokensIn = 0;
  private tokensOut = 0;
  private tokensCached: number | null = null;
  private tokensReasoning: number | null = null;
  private llmCalls = 0;
  private budgetReport: BudgetReport | null = null;
  private assemblies = 0;
  // llRunId → started (bridges handleChatModelStart → handleLLMEnd within this run only)
  private readonly startedCalls = new Set<string>();

  constructor(
    readonly runId: string,
    private readonly startedAt = Date.now(),
  ) {}

  /**
   * Records one context assembly's report (AC-1323). Last one wins (D-B: the
   * last assembly is the largest context of a run); `assemblies` counts every
   * attach so queries can separate single-call runs from tool loops.
   */
  attachBudgetReport(report: BudgetReport): void {
    this.budgetReport = report;
    this.assemblies += 1;
  }

  handler(): BaseCallbackHandler {
    return new LlmMetricsHandler(this.runId, this);
  }

  /** Called by the handler for a call whose metadata.runId is ours. */
  onStart(llmRunId: string, model: string): void {
    this.startedCalls.add(llmRunId);
    this.llmCalls += 1;
    this.model = model;
  }

  /** Called by the handler; only counted for calls it started. */
  onEnd(
    llmRunId: string,
    tokensIn: number,
    tokensOut: number,
    cacheReadTokens: number | null = null,
    reasoningTokens: number | null = null,
  ): void {
    if (this.startedCalls.has(llmRunId)) {
      this.startedCalls.delete(llmRunId);
      this.tokensIn += tokensIn;
      this.tokensOut += tokensOut;
      if (cacheReadTokens !== null) {
        this.tokensCached = (this.tokensCached ?? 0) + cacheReadTokens;
      }
      if (reasoningTokens !== null) {
        this.tokensReasoning = (this.tokensReasoning ?? 0) + reasoningTokens;
      }
    }
  }

  snapshot(): RunMetrics {
    return {
      model: this.model,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      tokensCached: this.tokensCached,
      tokensReasoning: this.tokensReasoning,
      latencyMs: Date.now() - this.startedAt,
      llmCalls: this.llmCalls,
      budgetReport: this.budgetReport,
      assemblies: this.assemblies,
    };
  }
}

/**
 * The LangChain callback that feeds the collector. Ignores calls whose
 * `metadata.runId` is not the collector's run — the phase-summary call sets
 * `runId: undefined` on purpose (today's BACKLOG note, now a test).
 */
class LlmMetricsHandler extends BaseCallbackHandler {
  name = 'LlmMetricsHandler';

  constructor(
    private readonly runId: string,
    private readonly collector: RunMetricsCollector,
  ) {
    super();
  }

  handleChatModelStart(
    _llm: unknown,
    _messages: unknown,
    llmRunId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
    _tags?: string[],
    metadata?: Record<string, unknown>,
  ): void {
    if (metadata?.['runId'] !== this.runId) {
      return;
    }
    const invocationParams = extraParams?.['invocation_params'] as Record<string, unknown> | undefined;
    const invocationModel = (invocationParams?.['model'] as string | undefined) ?? 'unknown';
    this.collector.onStart(llmRunId, invocationModel);
  }

  handleLLMEnd(
    output: {
      generations: Array<Array<{ text: string; message?: { usage_metadata?: UsageMetadataLike } }>>;
      llmOutput?: { tokenUsage?: { promptTokens?: number; completionTokens?: number } };
    },
    llmRunId: string,
  ): void {
    const usage = extractUsageFromLLMResult(output);
    this.collector.onEnd(
      llmRunId,
      usage.inputTokens ?? 0,
      usage.outputTokens ?? 0,
      usage.cacheReadTokens,
      usage.reasoningTokens,
    );
  }
}
