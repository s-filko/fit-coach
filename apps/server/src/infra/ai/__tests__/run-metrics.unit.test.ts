import type { BudgetReport } from '@domain/conversation/ports';

import {
  attachBudgetReport,
  bindCallToRun,
  drainRunMetrics,
  finishLlmCall,
  resolveCallRun,
  startLlmCall,
  startRun,
} from '@infra/ai/run-metrics';

const report = (total: number): BudgetReport => ({
  estimator: 'chars4x1.15',
  system: total,
  summary: 0,
  history: 0,
  user: 0,
  inFlight: 0,
  toolResults: 0,
  total,
  messages: 2,
  historyTurns: 0,
});

describe('run metrics accumulator (ADR-0013 §8, AC-1301)', () => {
  it('sums tokens and counts calls across several LLM calls in one run', () => {
    startLlmCall('run-1', 'z-ai/glm-5.3');
    finishLlmCall('run-1', 100, 20);
    startLlmCall('run-1', 'z-ai/glm-5.3');
    finishLlmCall('run-1', 150, 30);

    const metrics = drainRunMetrics('run-1');
    expect(metrics.tokensIn).toBe(250);
    expect(metrics.tokensOut).toBe(50);
    expect(metrics.llmCalls).toBe(2);
    expect(metrics.model).toBe('z-ai/glm-5.3');
    expect(metrics.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('drains: a second drain of the same run returns an empty record', () => {
    startLlmCall('run-2', 'z-ai/glm-5.3');
    finishLlmCall('run-2', 10, 5);
    drainRunMetrics('run-2');

    const second = drainRunMetrics('run-2');
    expect(second.llmCalls).toBe(0);
    expect(second.tokensIn).toBe(0);
    expect(second.model).toBeNull();
  });

  it('keeps runs isolated from each other', () => {
    startLlmCall('run-a', 'model-a');
    finishLlmCall('run-a', 7, 3);
    startLlmCall('run-b', 'model-b');
    finishLlmCall('run-b', 11, 4);

    expect(drainRunMetrics('run-a').tokensIn).toBe(7);
    expect(drainRunMetrics('run-b').tokensIn).toBe(11);
  });

  it('ignores calls with no runId without throwing', () => {
    expect(() => startLlmCall('', 'model')).not.toThrow();
    expect(() => finishLlmCall('', 1, 1)).not.toThrow();
    expect(drainRunMetrics('').llmCalls).toBe(0);
  });

  it('measures latency from startRun, not from the first LLM call', async () => {
    startRun('run-timed');
    await new Promise(resolve => setTimeout(resolve, 30));
    startLlmCall('run-timed', 'model');
    finishLlmCall('run-timed', 1, 1);

    // The clock starts at startRun, so the 30 ms before any model call counts.
    expect(drainRunMetrics('run-timed').latencyMs).toBeGreaterThanOrEqual(25);
  });

  it('startRun opens a run that records no calls of its own', () => {
    startRun('run-empty');
    const metrics = drainRunMetrics('run-empty');
    expect(metrics.llmCalls).toBe(0);
    expect(metrics.model).toBeNull();
  });

  describe('call-to-run binding (no shared "last id" state)', () => {
    it('attributes interleaved concurrent calls to the right runs', () => {
      // The failure mode this replaces: start(A), start(B), end(A) must not
      // credit A's tokens to B. See Step 5 for why a module-level id breaks.
      startRun('run-A');
      startRun('run-B');
      startLlmCall('run-A', 'model');
      bindCallToRun('lc-call-1', 'run-A');
      startLlmCall('run-B', 'model');
      bindCallToRun('lc-call-2', 'run-B');

      finishLlmCall(resolveCallRun('lc-call-1') as string, 100, 10);
      finishLlmCall(resolveCallRun('lc-call-2') as string, 7, 3);

      expect(drainRunMetrics('run-A').tokensIn).toBe(100);
      expect(drainRunMetrics('run-B').tokensIn).toBe(7);
    });

    it('drops the binding on read and ignores unknown or empty call ids', () => {
      bindCallToRun('lc-call-3', 'run-C');
      expect(resolveCallRun('lc-call-3')).toBe('run-C');
      expect(resolveCallRun('lc-call-3')).toBeUndefined();
      expect(resolveCallRun('never-bound')).toBeUndefined();
      expect(() => bindCallToRun('', 'run-C')).not.toThrow();
    });
  });

  describe('budget reports (refactor-p2-context-assembler, AC-1323)', () => {
    it('attach on an unknown runId opens the run (evals never call startRun)', () => {
      attachBudgetReport('run-b1', report(42));

      const metrics = drainRunMetrics('run-b1');
      expect(metrics.budgetReport).toEqual(report(42));
      expect(metrics.assemblies).toBe(1);
    });

    it('last attach wins and assemblies counts every attach', () => {
      attachBudgetReport('run-b2', report(10));
      attachBudgetReport('run-b2', report(20));

      const metrics = drainRunMetrics('run-b2');
      expect(metrics.budgetReport).toEqual(report(20));
      expect(metrics.assemblies).toBe(2);
    });

    it('a drain without any attach returns budgetReport null and assemblies 0', () => {
      const metrics = drainRunMetrics('run-b3');
      expect(metrics.budgetReport).toBeNull();
      expect(metrics.assemblies).toBe(0);
    });

    it('an empty runId is a no-op', () => {
      expect(() => attachBudgetReport('', report(1))).not.toThrow();
      expect(drainRunMetrics('').budgetReport).toBeNull();
    });
  });
});
