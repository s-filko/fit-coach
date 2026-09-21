/**
 * REPRODUCTION (RED) — AC-LSR-6 / BUG-022 (loss half). Runs only via an explicit --testMatch (needs
 * the local fitcoach_test database); promoted to a regular scenario test when the fix lands.
 *
 * The inbound message reaches the graph checkpoint before the model is called, but the transcript
 * row is written by the commit node at the END of a run. A run whose model call throws never
 * reaches commit, so the message survives only in the LangGraph checkpoint and conversation_turns
 * (the transcript of record, INV-LLM-001) has nothing. Live evidence: 2026-09-21, "накинул 10кг и
 * сделал еще подход на 12" — run ended core_error, absent from conversation_turns, present in the
 * checkpoint, and it is what made the next run log 120 kg.
 *
 * Real production wiring (registerInfraServices), real graph, adapter, repositories and
 * PostgresSaver; only the ChatModel beneath the gateway is replaced — it answers a scripted text
 * or throws, exactly like the scripted model of the other scenario tests.
 */
import { and, eq } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { conversationRuns, conversationTurns } from '@infra/db/schema';

import { runScenario } from '../../../evals/lib/run-scenario';
import type { Scenario } from '../../../evals/schema/scenario.schema';

// jest.mock factories may only reference variables prefixed with `mock`.
const mockModelState = { failNextCall: false };

jest.mock('@infra/ai/model.factory', () => {
  const model = {
    bindTools: () => model,
    invoke: async () => {
      if (mockModelState.failNextCall) {
        mockModelState.failNextCall = false;
        throw new Error('simulated model failure');
      }
      return new (jest.requireActual('@langchain/core/messages').AIMessage)({ content: 'Хорошо.', tool_calls: [] });
    },
    withConfig: () => ({ invoke: async () => ({ content: '{}' }) }),
  };
  return { getModel: () => model };
});

const OK_MESSAGE = 'привет, начинаю тренировку';
const LOST_MESSAGE = 'накинул 10кг и сделал еще подход на 12';

const scenarioFor = (id: string, text: string): Scenario => ({
  id,
  description: 'BUG-022 loss half: one run that succeeds, one whose model call throws',
  past: {
    user: {
      languageCode: 'ru',
      timezone: 'Europe/Berlin',
      firstName: 'Alex',
      age: 30,
      gender: 'male',
      height: 180,
      weight: 80,
      fitnessLevel: 'intermediate',
      fitnessGoal: 'strength',
      registrationCompleted: true,
    },
    workouts: [],
    facts: [],
  },
  steps: [{ action: 'user', text, script: [{ text: 'Хорошо.' }], expect: {} }],
});

/** Human-message rows the transcript holds for the user, by text. */
async function humanTurnTexts(userId: string): Promise<string[]> {
  const rows = await db
    .select({ content: conversationTurns.content })
    .from(conversationTurns)
    .where(and(eq(conversationTurns.userId, userId), eq(conversationTurns.kind, 'human')));
  return rows.map(r => r.content);
}

describe('a run whose graph throws still leaves the user message in conversation_turns (BUG-022)', () => {
  let userId: string;
  let failure: unknown;

  beforeAll(async () => {
    const ok = await runScenario(scenarioFor('failed-run-transcript-repro-ok', OK_MESSAGE), {
      onSeeded: world => {
        ({ userId } = world);
      },
    });
    expect(ok.steps[0]!.delivered).toBe('Хорошо.');
  });

  it('control: a run that completes leaves its user message in the transcript', async () => {
    expect(await humanTurnTexts(userId)).toContain(OK_MESSAGE);
  });

  it('a run that fails inside the graph leaves its user message in the transcript', async () => {
    let failedUserId = '';
    mockModelState.failNextCall = true;
    try {
      await runScenario(scenarioFor('failed-run-transcript-repro-fail', LOST_MESSAGE), {
        onSeeded: world => {
          ({ userId: failedUserId } = world);
        },
      });
    } catch (err) {
      failure = err;
    }

    // Preconditions: the run really failed, and it was recorded as a failed run (D-F).
    expect(failure).toBeDefined();
    const [runRow] = await db.select().from(conversationRuns).where(eq(conversationRuns.userId, failedUserId));
    expect(runRow?.outcome).toBe('core_error');

    expect(await humanTurnTexts(failedUserId)).toContain(LOST_MESSAGE);
  });
});
