// Shared harness for the conversation-graph tests (episode-memory and
// user-facts scenario): one USER fixture and one ctxConfig builder. Not a
// `.unit.test.ts` file, so jest's testMatch never picks it up.

import { RunMetricsCollector } from '@infra/ai/run-metrics';

export const USER = {
  id: 'u1',
  firstName: 'Test',
  languageCode: 'ru',
  profileStatus: 'complete',
  registrationCompleted: true,
};

/**
 * The `graph.invoke` config. `now` defaults to the wall clock; the user-facts
 * scenario passes a controlled clock (BR-LLM-001's inactivity trigger input).
 */
export function ctxConfig(opts: { runId: string; userId?: string; now?: Date }) {
  const { runId, userId = 'u1', now = new Date() } = opts;
  return {
    configurable: { thread_id: userId },
    metadata: { runId, userId },
    context: {
      runId,
      userId,
      user: USER as never,
      now,
      client: 'telegram' as const,
      trigger: 'user_message' as const,
      metrics: new RunMetricsCollector(runId),
    },
    recursionLimit: 25,
  } as never;
}
