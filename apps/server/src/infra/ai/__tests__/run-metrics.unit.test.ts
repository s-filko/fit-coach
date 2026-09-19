import type { BudgetReport } from '@domain/conversation/ports';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

const report = (total: number): BudgetReport => ({
  estimator: 'chars4x1.15',
  system: total,
  longTerm: 0,
  summary: 0,
  domain: 0,
  blocks: [],
  history: 0,
  user: 0,
  inFlight: 0,
  toolResults: 0,
  total,
  messages: 2,
  historyTurns: 0,
});

describe('RunMetricsCollector (ADR-0013 §8, AC-1301; per-run instance since run-context-commit)', () => {
  it('sums tokens and counts calls across several model calls in one run', () => {
    const collector = new RunMetricsCollector('run-1');
    collector.onStart('call-1', 'z-ai/glm-5.3');
    collector.onEnd('call-1', 100, 20);
    collector.onStart('call-2', 'z-ai/glm-5.3');
    collector.onEnd('call-2', 150, 30);

    const metrics = collector.snapshot();
    expect(metrics.tokensIn).toBe(250);
    expect(metrics.tokensOut).toBe(50);
    expect(metrics.llmCalls).toBe(2);
    expect(metrics.model).toBe('z-ai/glm-5.3');
    expect(metrics.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('the model is the last one seen', () => {
    const collector = new RunMetricsCollector('run-2');
    collector.onStart('c1', 'model-a');
    collector.onEnd('c1', 1, 1);
    collector.onStart('c2', 'model-b');

    expect(collector.snapshot().model).toBe('model-b');
  });

  it('runs are isolated: two collectors never share state', () => {
    const a = new RunMetricsCollector('run-a');
    const b = new RunMetricsCollector('run-b');
    a.onStart('c1', 'model-a');
    a.onEnd('c1', 7, 3);
    b.onStart('c2', 'model-b');
    b.onEnd('c2', 11, 4);

    expect(a.snapshot().tokensIn).toBe(7);
    expect(b.snapshot().tokensIn).toBe(11);
  });

  it('attachBudgetReport: last wins, every attach counted', () => {
    const collector = new RunMetricsCollector('run-3');
    collector.attachBudgetReport(report(100));
    collector.attachBudgetReport(report(200));

    expect(collector.snapshot().budgetReport?.total).toBe(200);
    expect(collector.snapshot().assemblies).toBe(2);
  });

  it('snapshot is repeatable (no drain semantics on an instance)', () => {
    const collector = new RunMetricsCollector('run-4');
    collector.onStart('c1', 'm');
    collector.onEnd('c1', 10, 5);

    expect(collector.snapshot().tokensIn).toBe(10);
    expect(collector.snapshot().tokensIn).toBe(10);
  });

  it("the handler ignores calls whose metadata.runId is not the collector's run", () => {
    const collector = new RunMetricsCollector('run-5');
    const handler = collector.handler();

    const start = handler.handleChatModelStart?.bind(handler) as (
      llm: unknown,
      messages: unknown,
      runId: string,
      parentRunId?: string,
      extraParams?: Record<string, unknown>,
      tags?: string[],
      metadata?: Record<string, unknown>,
    ) => void;
    const end = handler.handleLLMEnd?.bind(handler) as (output: unknown, runId: string) => void;
    const usage = (promptTokens: number, completionTokens: number): unknown => ({
      generations: [],
      llmOutput: { tokenUsage: { promptTokens, completionTokens } },
    });

    // A foreign call (the phase-summary call sets runId: undefined on purpose)
    start({}, [], 'foreign-call', undefined, undefined, undefined, { invocation_params: { model: 'm' } });
    end(usage(999, 999), 'foreign-call');
    expect(collector.snapshot().llmCalls).toBe(0);
    expect(collector.snapshot().tokensIn).toBe(0);

    // Our call counts
    start({}, [], 'own-call', undefined, { invocation_params: { model: 'm' } }, undefined, { runId: 'run-5' });
    end(usage(10, 5), 'own-call');
    expect(collector.snapshot().llmCalls).toBe(1);
    expect(collector.snapshot().tokensIn).toBe(10);
  });

  it('onEnd only counts calls the handler started (stray ends are dropped)', () => {
    const collector = new RunMetricsCollector('run-6');
    collector.onEnd('never-started', 100, 100);
    expect(collector.snapshot().tokensIn).toBe(0);
    expect(collector.snapshot().llmCalls).toBe(0);
  });
});
