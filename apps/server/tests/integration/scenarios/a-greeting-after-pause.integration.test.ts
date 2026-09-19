/**
 * Journey A, deterministic layer (training-journey-scenarios plan, Task 3 /
 * AC-TJ-2, AC-TJ-3): the BUG-018 reproduction over the real test database —
 * "привет" after a 14 h pause, with two past workouts, an active plan, one
 * fact, one stored episode summary ("plan ready, pending save") and a
 * one-turn exchange already in the checkpoint. The scripted model greets AND
 * calls `request_transition(session_planning)` in one AI message, then writes
 * the final text after the tool result.
 *
 * `beforeAll` runs the journey once (real wiring via `runScenario`, Date-only
 * fake timers so `ctx.now` and the wall-clock reads follow the scenario
 * clock); every assertion below is its own test. The three BUG-018 points
 * are fixed (chat-continuity Tasks 1-3) and run as plain tests; the
 * knownBug machinery stays for any future reproduction.
 */
import { eq } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { conversationTurns } from '@infra/db/schema';
import type { BaseMessage } from '@langchain/core/messages';

import { runScenario, type ScenarioRunResult } from '../../../evals/lib/run-scenario';
import {
  assertionKnownBug,
  assertionText,
  ScenarioSchema,
  type TaggedAssertion,
} from '../../../evals/schema/scenario.schema';
import {
  FINAL_TEXT,
  GAP_NOTE_MARKER,
  GREETING_TEXT,
  scenario,
} from '../../../evals/scenarios/a-greeting-after-pause.scenario';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

/** The scenario's weekday labels are pinned to this T0 (see the scenario file). */
const T0 = new Date('2026-09-20T10:00:00.000Z');

/** jest's `FakeableAPI` minus 'Date' — the union itself is not exported by @types/jest. */
type RealTimerApi =
  | 'setTimeout'
  | 'clearTimeout'
  | 'setInterval'
  | 'clearInterval'
  | 'setImmediate'
  | 'clearImmediate'
  | 'nextTick'
  | 'queueMicrotask'
  | 'performance'
  | 'hrtime'
  | 'requestAnimationFrame'
  | 'cancelAnimationFrame'
  | 'requestIdleCallback'
  | 'cancelIdleCallback';

/** Timer APIs that must stay REAL — pg, PostgresSaver and the ONNX embedding
 * pipeline schedule work through them; only `Date` is faked. */
const REAL_TIMER_APIS: RealTimerApi[] = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'nextTick',
  'queueMicrotask',
  'performance',
  'hrtime',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
];

/** Duck-typed (_getType, not instanceof): jest.resetModules re-evaluates @langchain/core. */
function typeOf(m: BaseMessage | undefined): string {
  return (m as { _getType?: () => string } | undefined)?._getType?.() ?? '';
}

function textOf(m: BaseMessage | undefined): string {
  const content = m?.content;
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
}

const step = scenario.steps[0]!;
if (step.action !== 'user') {
  throw new Error(`journey A: the single step must be a user step, got '${step.action}'`);
}
const expect_ = step.expect ?? {};

let model: ScriptedModelHandle;
let result: ScenarioRunResult;
/** Everything the model was handed during the journey, one entry per model call. */
let seenCalls: BaseMessage[][];
/** The same observation flattened — substring assertions run against this. */
let seen: string;
/** `conversation_turns` rows linked to this step's run. */
let turnCount = 0;

beforeAll(async () => {
  expect(ScenarioSchema.parse(scenario)).toBeTruthy(); // the scenario is format-valid
  model = installScriptedModel();
  jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
  jest.setSystemTime(T0);
  model.enqueueChat(step.script ?? []);

  result = await runScenario(scenario, { onAdvance: now => jest.setSystemTime(now) });

  seenCalls = model.drainChatInputs();
  seen = seenCalls
    .flat()
    .map(m => textOf(m))
    .join('\n');

  const runRow = result.steps[0]!.runRow;
  if (runRow) {
    const turns = await db
      .select({ id: conversationTurns.id })
      .from(conversationTurns)
      .where(eq(conversationTurns.runId, runRow.runId));
    turnCount = turns.length;
  }
});

afterAll(() => {
  jest.useRealTimers();
});

describe('journey A — greeting after a pause (BUG-018 repro)', () => {
  // Task 4 Step 0: knownBug tags ride the individual `seen.mustMatch` entries.
  const seenEntries = expect_.seen?.mustMatch ?? [];
  const passingSeen = seenEntries.filter(e => assertionKnownBug(e) === null);
  const failingSeen = seenEntries.filter((e): e is TaggedAssertion => assertionKnownBug(e) !== null);

  describe('seen — what the model was handed', () => {
    it.each(passingSeen.map(assertionText))('model input contains "%s"', substring => {
      expect(seen).toContain(substring);
    });

    // Point 1 of BUG-018: the inactivity compaction returns kept: [] today,
    // so the earlier one-turn exchange never reaches the model.
    for (const entry of failingSeen) {
      test.failing(`model input contains "${entry.text}" [${entry.knownBug}]`, () => {
        expect(seen).toContain(entry.text);
      });
    }

    // Point 2 of BUG-018 beyond presence (fixed, Task 2): the note sits right
    // before the current user message ("привет"), not in the long-term blocks.
    test(`a time-gap note sits right before "привет"`, () => {
      expect(seen).toContain(GAP_NOTE_MARKER);
      const firstCall = seenCalls[0] ?? [];
      const currentIdx = firstCall.findIndex(m => typeOf(m) === 'human' && textOf(m).includes(step.text));
      expect(currentIdx).toBeGreaterThan(0);
      expect(textOf(firstCall[currentIdx - 1])).toContain(GAP_NOTE_MARKER);
    });
  });

  describe('delivered — what the user got', () => {
    // Point 3 of BUG-018 (fixed, Task 3): the reply carries every non-empty
    // AI text of the run, so the greeting arrives with the final text.
    test(`the reply contains the greeting`, () => {
      const delivered = result.steps[0]!.delivered;
      for (const substring of expect_.delivered?.mustMatch ?? []) {
        expect(delivered).toContain(substring);
      }
    });

    it('the reply is every scripted text of the run, in order (AC-CC-3)', () => {
      expect(result.steps[0]!.delivered).toBe(`${GREETING_TEXT}\n\n${FINAL_TEXT}`);
    });
  });

  describe('persisted — what the DB holds after the step', () => {
    it('a conversation_runs row exists for the run', () => {
      const runRow = result.steps[0]!.runRow;
      expect(runRow).not.toBeNull();
      expect(runRow!.outcome).toBe('ok');
      expect(runRow!.phaseIn).toBe('chat');
    });

    it('the run row records the applied transition to session_planning', () => {
      const runRow = result.steps[0]!.runRow;
      expect(runRow!.phaseOut).toBe('session_planning');
      expect(runRow!.transition).toEqual(expect.objectContaining({ toPhase: 'session_planning' }));
    });

    it('the run row records the request_transition tool call', () => {
      const toolCalls = result.steps[0]!.runRow?.toolCalls ?? [];
      expect(toolCalls.map(c => c.name)).toContain('request_transition');
    });

    it('conversation_turns rows link to this run', () => {
      expect(turnCount).toBeGreaterThan(0);
    });
  });

  it('phase after the step is session_planning', () => {
    expect(result.steps[0]!.phase).toBe(expect_.phaseAfter?.phase ?? 'session_planning');
  });

  it('consumed the whole script (no fallback answer leaked in)', () => {
    expect(model.chatScriptExhausted).toBe(true);
  });
});
