/**
 * INV-LLM-009 / BUG-022 (loss half). The inbound message is persisted before the graph runs, keyed by
 * run_id, so a run whose model call throws still leaves it in conversation_turns — exactly once,
 * even though the commit node projects the same message again at the end of a successful run.
 * Live evidence of the original loss: 2026-09-21, "накинул 10кг и сделал еще подход на 12" — that
 * run ended core_error, absent from conversation_turns, present only in the LangGraph checkpoint,
 * and it is what made the next run log 120 kg.
 *
 * Real production wiring (registerInfraServices), real graph, adapter, repositories and
 * PostgresSaver; only the ChatModel beneath the gateway is replaced, by the shared scripted model
 * (scripted-model.ts) — it answers a scripted text, or throws once via `failNextChat`.
 */
import { and, eq } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { conversationRuns, conversationTurns } from '@infra/db/schema';

import { runScenario } from '../../../evals/lib/run-scenario';
import type { Scenario } from '../../../evals/schema/scenario.schema';

import { buildAlexScenario } from './personas';
import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

const OK_MESSAGE = 'привет, начинаю тренировку';
const LOST_MESSAGE = 'накинул 10кг и сделал еще подход на 12';

const scenarioFor = (id: string, text: string): Scenario =>
  buildAlexScenario(id, 'BUG-022 loss half: one run that succeeds, one whose model call throws', text);

/** Human-message rows the transcript holds for the user, by text. */
async function humanTurnTexts(userId: string): Promise<string[]> {
  const rows = await db
    .select({ content: conversationTurns.content })
    .from(conversationTurns)
    .where(and(eq(conversationTurns.userId, userId), eq(conversationTurns.kind, 'human')));
  return rows.map(r => r.content);
}

/** How many human-message rows exist for this user with this exact text — the exactly-once half of INV-LLM-009. */
async function humanTurnCount(userId: string, text: string): Promise<number> {
  const rows = await db
    .select({ content: conversationTurns.content })
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.userId, userId),
        eq(conversationTurns.kind, 'human'),
        eq(conversationTurns.content, text),
      ),
    );
  return rows.length;
}

describe('a run whose graph throws still leaves the user message in conversation_turns (BUG-022)', () => {
  let userId: string;
  let failure: unknown;

  let model: ScriptedModelHandle;

  beforeAll(async () => {
    model = installScriptedModel();
    model.enqueueChat([{ text: 'Хорошо.' }]);
    const ok = await runScenario(scenarioFor('failed-run-transcript-repro-ok', OK_MESSAGE), {
      onSeeded: world => {
        ({ userId } = world);
      },
    });
    expect(ok.steps[0]!.delivered).toBe('Хорошо.');
  });

  it('control: a run that completes leaves its user message in the transcript exactly once', async () => {
    expect(await humanTurnTexts(userId)).toContain(OK_MESSAGE);
    expect(await humanTurnCount(userId, OK_MESSAGE)).toBe(1);
  });

  it('a run that fails inside the graph leaves its user message in the transcript exactly once', async () => {
    let failedUserId = '';
    model.failNextChat(new Error('simulated model failure'));
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
    expect(await humanTurnCount(failedUserId, LOST_MESSAGE)).toBe(1);
  });
});
