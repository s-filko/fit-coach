/**
 * Prompt-caching plan (BUG-051) D8.1: the raise sites of the declared cache-break reasons. One reason, named at
 * the code site that causes it, collected on the run's RunMetricsCollector and handed to the recorder per call.
 */
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';

import { ok } from '@domain/conversation/tool-outcome';

import { RunMetricsCollector } from '@infra/ai/run-metrics';

import { buildToolExecutor } from '../graph/tool-executor';

function configWith(metrics: RunMetricsCollector): RunnableConfig {
  return {
    configurable: { thread_id: 't-1' },
    metadata: { runId: 'run-1' },
    context: {
      runId: 'run-1',
      userId: 'u1',
      user: { languageCode: null },
      now: new Date(0),
      client: 'telegram' as const,
      trigger: 'user_message' as const,
      metrics,
    },
  } as never;
}

const tool = (name: string, result: unknown = ok('done')) =>
  ({ name, invoke: jest.fn().mockResolvedValue(result) }) as unknown as StructuredToolInterface;

function stateCalling(name: string) {
  return {
    messages: [
      new HumanMessage('запомни'),
      new AIMessage({ content: '', tool_calls: [{ id: 'c1', name, args: {}, type: 'tool_call' as const }] }),
    ],
  };
}

describe('RunMetricsCollector declarations', () => {
  it('collects each declared reason once, in declaration order', () => {
    const metrics = new RunMetricsCollector('r');
    expect(metrics.declaredCacheBreaks()).toEqual([]);
    metrics.declareCacheBreak('compaction');
    metrics.declareCacheBreak('facts_changed');
    metrics.declareCacheBreak('compaction');
    expect(metrics.declaredCacheBreaks()).toEqual(['compaction', 'facts_changed']);
  });
});

describe('executor raise site: a successful manage_fact declares facts_changed', () => {
  it('manage_fact ok → declared', async () => {
    const metrics = new RunMetricsCollector('run-1');
    const executor = buildToolExecutor([tool('manage_fact')], { llmErrorBudget: Infinity });
    await executor(stateCalling('manage_fact'), configWith(metrics));
    expect(metrics.declaredCacheBreaks()).toEqual(['facts_changed']);
  });

  it('a failed manage_fact, or any other tool, declares nothing', async () => {
    const metrics = new RunMetricsCollector('run-1');
    const failing = tool('manage_fact');
    (failing.invoke as jest.Mock).mockRejectedValue(new Error('boom'));
    await buildToolExecutor([failing], { llmErrorBudget: Infinity })(stateCalling('manage_fact'), configWith(metrics));
    await buildToolExecutor([tool('log_set')], { llmErrorBudget: Infinity })(
      stateCalling('log_set'),
      configWith(metrics),
    );
    expect(metrics.declaredCacheBreaks()).toEqual([]);
    expect(ToolMessage).toBeDefined();
  });
});
