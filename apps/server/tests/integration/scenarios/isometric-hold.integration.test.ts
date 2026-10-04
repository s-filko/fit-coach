/**
 * plan-fixes item 2 (AC-LPF-2, replay C2): a plank reported in seconds goes through `log_set` with
 * `durationSeconds` and must be stored as an `isometric` set (`{type:'isometric', duration}`), not as
 * `cardio_duration` or `functional_reps`; a cardio duration stays `cardio_duration`. Scripted model, real test DB,
 * journey B's setup (same wiring as `set-kind.integration.test.ts`).
 */
import { runScenario, type ScenarioRunResult } from '../../../evals/lib/run-scenario';
import type { Scenario } from '../../../evals/schema/scenario.schema';
import { setupSteps, sharedPast } from '../../../evals/scenarios/b-full-workout.scenario';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

const T0 = new Date('2026-09-20T10:00:00.000Z');
const LAST_STEP_INDEX = 8;

const scenarioDef: Scenario = {
  id: 'isometric-hold',
  description: 'AC-LPF-2: a plank logged in seconds is an isometric set; a bike duration stays cardio_duration',
  past: {
    ...sharedPast,
    // A name is seeded only when `past` mentions it — an earlier workout carries both exercises.
    workouts: [
      ...(sharedPast.workouts ?? []),
      {
        at: '-6d',
        key: 'core_day',
        exercises: [
          { exercise: 'Plank', sets: [{ durationSeconds: 30 }] },
          { exercise: 'Stationary Bike', sets: [{ durationSeconds: 300 }] },
        ],
      },
    ],
    catalog: [
      {
        name: 'Plank',
        exerciseType: 'isometric',
        category: 'functional',
        muscles: [{ group: 'core', involvement: 'primary' }],
      },
      {
        name: 'Stationary Bike',
        exerciseType: 'cardio_duration',
        category: 'cardio',
        muscles: [{ group: 'cardio_system', involvement: 'primary' }],
      },
    ],
  },
  steps: [
    ...setupSteps,
    { action: 'advance', at: '+5m' },
    {
      action: 'user',
      text: 'планка 45 секунд',
      script: [
        { text: 'Записал.', toolCall: { name: 'log_set', args: { exerciseName: 'Plank', durationSeconds: 45 } } },
        { text: 'Ок.' },
      ],
    },
    { action: 'advance', at: '+2m' },
    {
      action: 'user',
      text: 'планка ещё 50 секунд',
      script: [
        { text: 'Записал.', toolCall: { name: 'log_set', args: { exerciseName: 'Plank', durationSeconds: 50 } } },
        { text: 'Ок.' },
      ],
    },
    { action: 'advance', at: '+2m' },
    {
      action: 'user',
      text: 'велотренажёр 600 секунд',
      script: [
        {
          text: 'Записал.',
          toolCall: { name: 'log_set', args: { exerciseName: 'Stationary Bike', durationSeconds: 600 } },
        },
        { text: 'Ок.' },
      ],
    },
  ],
};

describe('isometric hold — scripted training scenario (AC-LPF-2)', () => {
  let model: ScriptedModelHandle;
  let result: ScenarioRunResult;

  beforeAll(async () => {
    model = installScriptedModel();
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);
    for (const step of scenarioDef.steps) {
      if (step.action === 'user') {
        model.enqueueChat(step.script ?? []);
      }
    }
    result = await runScenario(scenarioDef, { onAdvance: now => jest.setSystemTime(now) });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const setsOf = (name: string): unknown[] => {
    const session = result.steps[LAST_STEP_INDEX]!.sessions[0]!;
    return session.exercises.find(ex => ex.exercise.name === name)!.sets.map(s => s.setData);
  };

  it('stores both plank holds as isometric sets with their duration', () => {
    expect(setsOf('Plank')).toEqual([
      { type: 'isometric', duration: 45 },
      { type: 'isometric', duration: 50 },
    ]);
  });

  it('keeps a cardio duration as cardio_duration', () => {
    expect(setsOf('Stationary Bike')).toEqual([{ type: 'cardio_duration', duration: 600 }]);
  });
});
