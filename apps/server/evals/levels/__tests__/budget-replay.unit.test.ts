/**
 * AC-1343 replay (P4 context-budget plan Task 4): a 60-turn training
 * transcript is seeded into the checkpointed `messages` channel, then 10
 * consecutive mocked-model runs each append a set. Every run must keep
 * `budgetReport.history <= budget.history` (INV-LLM-004) and send no orphan
 * `ToolMessage`, and compaction by budget (BR-LLM-003) must fire at least
 * once (the stub `summaries.insert` receives a row).
 */
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ChatResult } from '@langchain/core/outputs';

import { buildConversationRunner } from '@infra/ai/graph/conversation-run.adapter';
import { buildConversationGraph } from '@infra/ai/graph/conversation.graph';
import { buildPhaseSpecs } from '@infra/ai/graph/phases';

import { ACTIVE_SESSION } from '../../fixtures/personas';
import { LONG_TRAINING_TRANSCRIPT } from '../../fixtures/long-training-transcript';
import { buildStubDeps } from '../../lib/build-stub-deps';
import { ModelInputRecorder } from '../../lib/run-case';
import { toBaseMessages } from '../../lib/seed-messages';

/** A real BaseChatModel (not a plain mock) so handleChatModelStart dispatches — ModelInputRecorder needs it. */
class ScriptedFakeChatModel extends BaseChatModel {
  static queue: AIMessage[] = [];
  _llmType(): string {
    return 'scripted-fake';
  }
  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    const message = ScriptedFakeChatModel.queue.shift() ?? new AIMessage({ content: 'Записал.', tool_calls: [] });
    return { generations: [{ text: String(message.content), message }] };
  }
  bindTools(): this {
    return this;
  }
}

jest.mock('@infra/ai/model.factory', () => ({
  getModel: () => new ScriptedFakeChatModel({}),
}));

const USER_ID = '22222222-2222-4222-8222-222222222222';

/** Each replay run: a log_set tool call, then the acknowledging text reply — two model calls. */
function queueOneSetRound(n: number): void {
  ScriptedFakeChatModel.queue.push(
    new AIMessage({
      content: '',
      tool_calls: [
        {
          id: `replay-call-${n}`,
          name: 'log_set',
          args: { exerciseId: '11111111-1111-4111-8111-111111111111', reps: 8, weight: 60 },
          type: 'tool_call',
        },
      ],
    }),
    new AIMessage({ content: `Подход ${n} записан.`, tool_calls: [] }),
  );
}

describe('AC-1343: long-transcript replay keeps history within budget and sends no orphan tool message', () => {
  it('AC-1343: 10 consecutive runs on a 60-turn seeded transcript — budgetReport.history <= budget.history and no orphan ToolMessage on every run, and BR-LLM-003 fires at least once', async () => {
    const { deps, summaryRecords, recordedRuns } = buildStubDeps(ACTIVE_SESSION);
    const modelInputRecorder = new ModelInputRecorder();

    const graph = buildConversationGraph(deps);
    const runner = buildConversationRunner({
      graph,
      userService: deps.userService,
      runService: deps.runService,
      checkpointer: deps.checkpointer,
      transcript: deps.transcript,
      extraCallbacks: [modelInputRecorder],
    });

    // Seed the 60-turn transcript into the checkpointed messages channel — the
    // same path production seeding uses (evals/lib/seed-messages.ts).
    await graph.updateState(
      { configurable: { thread_id: USER_ID } },
      {
        phase: 'training',
        activeSessionId: 'session-1',
        messages: toBaseMessages(LONG_TRAINING_TRANSCRIPT),
      },
    );

    // PhaseSpec.budget.history for 'training' — the same specs the graph built.
    const trainingBudgetHistory = buildPhaseSpecs(deps).find(s => s.name === 'training')!.budget.history;

    let compactionFired = false;
    for (let i = 0; i < 10; i += 1) {
      queueOneSetRound(i);
      // eslint-disable-next-line no-await-in-loop
      await runner.run({ userId: USER_ID, text: `Сделал ещё один подход номер ${i}, жим лёжа, 8 повторений 60 кг` });

      const lastRun = recordedRuns[recordedRuns.length - 1];
      expect(lastRun.budgetReport).not.toBeNull();
      expect(lastRun.budgetReport!.history).toBeLessThanOrEqual(trainingBudgetHistory);

      // No orphan ToolMessage: every ToolMessage in the last model input answers
      // a tool_call_id some AIMessage in the SAME input carries.
      const carriedIds = new Set(modelInputRecorder.last.flatMap(m => m.toolCallIds));
      for (const m of modelInputRecorder.last) {
        if (m.toolCallId !== undefined) {
          expect(carriedIds.has(m.toolCallId)).toBe(true);
        }
      }

      if (summaryRecords.length > 0) {
        compactionFired = true;
      }
    }

    expect(compactionFired).toBe(true);
    expect(summaryRecords.length).toBeGreaterThan(0);
  });
});

export { ScriptedFakeChatModel };
