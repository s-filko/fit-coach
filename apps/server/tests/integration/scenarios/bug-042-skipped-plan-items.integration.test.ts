/**
 * set-kind plan Task 2 (D6, D7, AC-SK-5, AC-SK-6): a scripted-model training scenario over the
 * real test DB, reproducing BUG-042 plus the session-place flow.
 *
 * BUG-042 (AC-SK-6): the upper_a plan carries Bench Press and Pull-ups; the user sets the place,
 * logs two bench sets and finishes WITHOUT ever touching Pull-ups. At finish the session must
 * gain a `session_exercises` row for Pull-ups with `status = 'skipped'` and the plan's targets
 * (today: no row is created at all), and the NEXT day's session must render its History
 * line as `skipped 2026-09-20, no completed record` (today: bare `no completed record`).
 *
 * Place (AC-SK-5): "я сегодня в другом зале" after the start must write
 * `workout_sessions.place` via `set_session_place` (today: the tool does not exist) and the next
 * turn's workout block must print `Place: Fitness House на Ленина`.
 *
 * Reuses journey B's setup (`setupSteps`/`sharedPast` — greeting → session_planning → proposal →
 * start_training_session), same production wiring as `set-kind.integration.test.ts`.
 *
 * Promoted from `bug-042-skipped-plan-items.repro.test.ts` once Task 2's finish reconciliation,
 * place tool and history skip line landed (was RED: no row for Pull-ups at finish, place null,
 * `set_session_place` rejected as an unknown tool, and the day-2 line read bare
 * `no completed record`).
 */
import { textOnly } from '@infra/ai/message-text';

import { runScenario, type ScenarioRunResult } from '../../../evals/lib/run-scenario';
import type { Scenario } from '../../../evals/schema/scenario.schema';
import { BENCH_PRESS_ID, PULL_UPS_ID, setupSteps, sharedPast } from '../../../evals/scenarios/b-full-workout.scenario';
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

/** Same T0 journey B pins (Sunday, Europe/Berlin) — the finish lands on calendar day 2026-09-20. */
const T0 = new Date('2026-09-20T10:00:00.000Z');

const PLACE_TEXT = 'я сегодня в другом зале, Fitness House на Ленина';
const PLACE_REPLY = 'Записал место.';
const PLACE_FOLLOWUP = 'Отлично, начнём с жима.';

const BENCH_1_TEXT = 'сделал жим 80 на 8';
const BENCH_1_REPLY = 'Записал!';
const BENCH_1_FOLLOWUP = 'Ок.';

const BENCH_2_TEXT = 'ещё раз 80 на 8';
const BENCH_2_REPLY = 'Записал!';
const BENCH_2_FOLLOWUP = 'Ок.';

const FINISH_TEXT = 'всё, закончил, подтягивания не делал';
const FINISH_TOOL_REPLY = 'Отличная работа! Отдыхай.';

/** Day 2: a fresh session whose History must show yesterday's skip. */
const D2_GREETING_TEXT = 'привет, хочу потренироваться';
const D2_GREETING_REPLY = 'Привет! Давай подберём тренировку.';
const D2_GREETING_FOLLOWUP = 'Какую группу сегодня нагружаем?';
const D2_GO_UPPER_TEXT = 'давай верх';
const D2_GO_UPPER_REPLY = 'Upper A: жим лёжа и подтягивания. Начинаем?';
const D2_LETS_GO_TEXT = 'да, поехали';
const D2_START_REPLY = 'Поехали!';
const D2_WHAT_NEXT_TEXT = 'что дальше?';
const D2_WHAT_NEXT_REPLY = 'Продолжаем.';

// setupSteps are steps 0–2; every user step after them is preceded by an advance.
// Day 2 has NO further advances: `resolveRelativeTime` resolves every offset against
// T0, so a '+2m' after '+1d' would wind the clock BACK to day 1 and corrupt the
// conversation state (observed: the day-2 phase checkpoint went stale).
const PLACE_STEP_INDEX = 4;
const BENCH_1_STEP_INDEX = 6;
const BENCH_2_STEP_INDEX = 8;
const FINISH_STEP_INDEX = 10;
const D2_WHAT_NEXT_STEP_INDEX = 15;

const START_ARGS = {
  sessionKey: 'upper_a',
  sessionName: 'Upper A',
  reasoning: 'Upper day per the active split.',
  exercises: [
    {
      exerciseId: BENCH_PRESS_ID,
      exerciseName: 'Barbell Bench Press',
      targetSets: 3,
      targetReps: '8-10',
      targetWeight: 80,
      restSeconds: 120,
    },
    { exerciseId: PULL_UPS_ID, exerciseName: 'Pull-ups', targetSets: 3, targetReps: '6-8', restSeconds: 120 },
  ],
  estimatedDuration: 60,
};

const scenarioDef: Scenario = {
  id: 'bug-042-skipped-plan-items',
  description:
    'AC-SK-5/AC-SK-6: an untouched plan exercise becomes skipped at finish (BUG-042) and the ' +
    'next session reads the skip; set_session_place records the place and the overview prints it',
  past: sharedPast,
  steps: [
    ...setupSteps,
    { action: 'advance', at: '+5m' },
    {
      action: 'user',
      text: PLACE_TEXT,
      script: [
        { text: PLACE_REPLY, toolCall: { name: 'set_session_place', args: { place: 'Fitness House на Ленина' } } },
        { text: PLACE_FOLLOWUP },
      ],
    },
    { action: 'advance', at: '+6m' },
    {
      action: 'user',
      text: BENCH_1_TEXT,
      script: [
        {
          text: BENCH_1_REPLY,
          toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 8, weight: 80 } },
        },
        { text: BENCH_1_FOLLOWUP },
      ],
    },
    { action: 'advance', at: '+9m' },
    {
      action: 'user',
      text: BENCH_2_TEXT,
      script: [
        {
          text: BENCH_2_REPLY,
          toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 8, weight: 80 } },
        },
        { text: BENCH_2_FOLLOWUP },
      ],
    },
    { action: 'advance', at: '+13m' },
    {
      action: 'user',
      text: FINISH_TEXT,
      script: [{ toolCall: { name: 'finish_training', args: {} } }, { text: FINISH_TOOL_REPLY }],
    },
    // Next calendar day: a fresh session must see yesterday's skip in its History.
    // All day-2 user steps run back-to-back after the single '+1d' advance (see the
    // index comment above for why no further advances follow it).
    { action: 'advance', at: '+1d' },
    {
      action: 'user',
      text: D2_GREETING_TEXT,
      script: [
        {
          text: D2_GREETING_REPLY,
          toolCall: {
            name: 'request_transition',
            args: { toPhase: 'session_planning', reason: 'user wants to train' },
          },
        },
        { text: D2_GREETING_FOLLOWUP },
      ],
    },
    { action: 'user', text: D2_GO_UPPER_TEXT, script: [{ text: D2_GO_UPPER_REPLY }] },
    {
      action: 'user',
      text: D2_LETS_GO_TEXT,
      script: [{ toolCall: { name: 'start_training_session', args: START_ARGS } }, { text: D2_START_REPLY }],
    },
    { action: 'user', text: D2_WHAT_NEXT_TEXT, script: [{ text: D2_WHAT_NEXT_REPLY }] },
  ],
};

describe('bug-042 skipped plan items + session place — scripted training scenario (set-kind plan D6, D7)', () => {
  let model: ScriptedModelHandle;
  let result: ScenarioRunResult;
  const seenByStep = new Map<number, string>();

  beforeAll(async () => {
    model = installScriptedModel();
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);
    for (const step of scenarioDef.steps) {
      if (step.action === 'user') {
        model.enqueueChat(step.script ?? []);
      }
    }

    result = await runScenario(scenarioDef, {
      onAdvance: now => jest.setSystemTime(now),
      onStep: obs => {
        if (obs.action !== 'user') {
          return;
        }
        const calls = model.drainChatInputs();
        seenByStep.set(
          obs.stepIndex,
          calls
            .flat()
            .map(m => textOnly(m.content) ?? JSON.stringify(m.content ?? ''))
            .join('\n'),
        );
      },
    });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('finish creates a skipped session_exercises row for the untouched plan exercise with the plan targets (BUG-042, AC-SK-6)', () => {
    const session = result.steps[FINISH_STEP_INDEX]!.sessions[0]!;
    expect(session.status).toBe('completed');

    const skipped = session.exercises.find(ex => ex.exerciseId === PULL_UPS_ID)!;
    expect(skipped).toBeDefined();
    expect(skipped.status).toBe('skipped');
    expect(skipped.targetSets).toBe(3);
    expect(skipped.targetReps).toBe('6-8');
  });

  it('the touched exercise ends completed, not skipped (AC-SK-6)', () => {
    const session = result.steps[FINISH_STEP_INDEX]!.sessions[0]!;
    const bench = session.exercises.find(ex => ex.exerciseId === BENCH_PRESS_ID)!;
    expect(bench.status).toBe('completed');
    expect(bench.sets).toHaveLength(2);
  });

  it('set_session_place writes workout_sessions.place and the next overview prints it (AC-SK-5)', () => {
    const session = result.steps[BENCH_1_STEP_INDEX]!.sessions[0]!;
    // `place` lands on the domain type with the fix; the cast keeps this test compilable while RED.
    expect((session as WorkoutSessionWithDetails & { place?: string | null }).place).toBe('Fitness House на Ленина');

    const seen = seenByStep.get(BENCH_1_STEP_INDEX) ?? '';
    expect(seen).toContain('Place: Fitness House на Ленина');
  });

  it("the next day's History reads the skip, not a bare 'no earlier record' (BUG-042, AC-SK-6)", () => {
    const seen = seenByStep.get(D2_WHAT_NEXT_STEP_INDEX) ?? '';
    const lines = seen.split('\n');
    const headerAt = lines.findIndex(l => l.startsWith('Pull-ups (today'));
    const pullUpsLine = lines[headerAt + 1] ?? '';

    expect(headerAt).toBeGreaterThan(-1);
    expect(pullUpsLine).toMatch(/^- skipped .*Sep 20 \(planned, not done\)$/);
    expect(pullUpsLine).not.toContain('no earlier record');
  });

  it('delivers the scripted replies', () => {
    expect(result.steps[PLACE_STEP_INDEX]!.delivered).toContain(PLACE_REPLY);
    expect(result.steps[FINISH_STEP_INDEX]!.delivered).toContain(FINISH_TOOL_REPLY);
  });
});
