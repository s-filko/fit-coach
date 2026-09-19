/**
 * Task 2 smoke (AC-TJ-2 infra): one seeded workout, one user step — proves the
 * whole DB-backed scenario path end to end: real rows seeded from a scenario's
 * `past`, the checkpoint seeded via `updateState`, the REAL production wiring
 * through `registerInfraServices(new Container())`, a scripted model beneath
 * the real gateway, and the observation planes (seen / persisted / delivered).
 *
 * This file is also the fake-timer spike: Date-only fake timers
 * (`advanceTimers: true`, every timer API in `doNotFake`) must keep `pg` and
 * `PostgresSaver` working — green here means the spike succeeded and no `now`
 * seam on the runner deps is needed.
 */
import { runScenario, type ScenarioRunResult } from '../../../evals/lib/run-scenario';
import { ScenarioSchema, type Scenario } from '../../../evals/schema/scenario.schema';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

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

const scenario: Scenario = {
  id: 'harness-smoke',
  description: 'Task 2 smoke: one seeded workout, one greeting step',
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
    workouts: [
      {
        at: '-2d',
        key: 'upper_a',
        exercises: [
          {
            exercise: 'Barbell Bench Press',
            sets: [
              { reps: 8, weight: 80 },
              { reps: 8, weight: 80 },
            ],
          },
        ],
      },
    ],
    facts: [],
  },
  steps: [
    {
      action: 'user',
      text: 'привет',
      script: [{ text: 'Привет! Рад тебя видеть.' }],
      expect: {},
    },
  ],
};

let model: ScriptedModelHandle;
let result: ScenarioRunResult;
let seenThisStep: string;

beforeAll(async () => {
  expect(ScenarioSchema.parse(scenario)).toBeTruthy(); // the scenario is format-valid
  model = installScriptedModel();
  jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
  jest.setSystemTime(T0);
  model.enqueueChat(scenario.steps[0]!.action === 'user' ? (scenario.steps[0]!.script ?? []) : []);

  result = await runScenario(scenario, { onAdvance: now => jest.setSystemTime(now) });

  // The `seen` observation: everything the model was handed during the step.
  seenThisStep = model
    .drainChatInputs()
    .flat()
    .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');
});

afterAll(() => {
  jest.useRealTimers();
});

describe('harness smoke — one seeded workout, one step', () => {
  it('delivers the scripted text', () => {
    const step = result.steps[0]!;
    expect(step.action).toBe('user');
    expect(step.delivered).toBe('Привет! Рад тебя видеть.');
  });

  it('records a conversation_runs row for the run', () => {
    const runRow = result.steps[0]!.runRow;
    expect(runRow).not.toBeNull();
    expect(runRow!.outcome).toBe('ok');
    expect(runRow!.phaseIn).toBe('chat');
    // No transition was requested — phaseOut stays null (commit sets it only on
    // an applied transition).
    expect(runRow!.phaseOut).toBeNull();
  });

  it('showed the model the seeded workout in the chat context', () => {
    expect(seenThisStep).toContain('RECENT TRAINING HISTORY');
    expect(seenThisStep).toContain('upper_a');
    expect(seenThisStep).toContain('Barbell Bench Press');
  });

  it('snapshots the seeded workout from the DB', () => {
    const sessions = result.steps[0]!.sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionKey).toBe('upper_a');
    expect(sessions[0]!.status).toBe('completed');
    expect(sessions[0]!.exercises[0]!.exercise.name).toBe('Barbell Bench Press');
    expect(sessions[0]!.exercises[0]!.sets).toHaveLength(2);
  });

  it('stays in the chat phase', () => {
    expect(result.steps[0]!.phase).toBe('chat');
  });

  it('consumed the whole script (no fallback answer leaked in)', () => {
    expect(model.chatScriptExhausted).toBe(true);
  });
});
