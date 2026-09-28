/**
 * set-kind plan Task 1 (D2, D3, D4, AC-SK-1, AC-SK-2): a scripted-model training scenario over
 * the real test DB. The user logs two warm-up sets and one working set for Bench Press against a
 * 3-set plan target — `session_sets.set_kind` must record `warmup, warmup, working`, the
 * confirmation must name the warm-up sets, and the next turn's WORKOUT OVERVIEW must count only
 * the working set against the target.
 *
 * RED today: the `log_set` schema silently drops the unknown `setKind` field (zod strips it),
 * `session_sets` has no `set_kind` column to persist it in the first place, the confirmation never
 * says "(warm-up)", and the guide/ACTIVE STATUS count all three sets — "(3/3 sets)", not "(1/3
 * sets)".
 *
 * Reuses journey B's setup (`setupSteps`/`sharedPast` — greeting → session_planning → proposal →
 * start_training_session), same production wiring as `exercise-history-lookup-scripted.integration.test.ts`.
 */
import { runScenario, type ScenarioRunResult } from '../../../evals/lib/run-scenario';
import type { Scenario } from '../../../evals/schema/scenario.schema';
import { BENCH_PRESS_ID, setupSteps, sharedPast } from '../../../evals/scenarios/b-full-workout.scenario';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

/** Same T0 journey B pins (Sunday, Europe/Berlin). */
const T0 = new Date('2026-09-20T10:00:00.000Z');

const WARMUP_1_TEXT = 'разминка 40 на 10';
const WARMUP_2_TEXT = 'ещё разминка 40 на 10';
const WORKING_TEXT = 'рабочий подход 60 на 10';
const NEXT_TEXT = 'что дальше?';

const WARMUP_1_REPLY = 'Разминочный записан.';
const WARMUP_2_REPLY = 'Ещё один разминочный.';
const WORKING_REPLY = 'Рабочий подход записан.';
const NEXT_REPLY = 'Продолжаем.';

/**
 * The after-tool reply for each set-logging step. Each of those steps' AI message bundles
 * text+toolCall in ONE message (like b-full-workout's bench-set steps) — the graph then calls
 * the model AGAIN once the tool has run, and that second call needs its OWN queued, tool-call-free
 * reply. Without one, the mock's global FIFO queue would hand it the NEXT step's entry instead,
 * running that step's tool call early and cascading the whole scenario out of order.
 */
const WARMUP_1_FOLLOWUP = 'Ок.';
const WARMUP_2_FOLLOWUP = 'Ок.';
const WORKING_FOLLOWUP = 'Ок.';

/** setupSteps (3 user steps) + one advance + the 3 set-logging steps, each preceded by an advance. */
const WARMUP_1_STEP_INDEX = 4;
const WARMUP_2_STEP_INDEX = 6;
const WORKING_STEP_INDEX = 8;
const NEXT_STEP_INDEX = 10;

const scenarioDef: Scenario = {
  id: 'set-kind',
  description:
    'AC-SK-1/AC-SK-2: two warm-up sets and one working set against a 3-set target — set_kind ' +
    'persists per set, the confirmation names the warm-up, and only the working set counts',
  past: sharedPast,
  steps: [
    ...setupSteps,
    { action: 'advance', at: '+5m' },
    {
      action: 'user',
      text: WARMUP_1_TEXT,
      script: [
        {
          text: WARMUP_1_REPLY,
          toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 10, weight: 40, setKind: 'warmup' } },
        },
        { text: WARMUP_1_FOLLOWUP },
      ],
    },
    { action: 'advance', at: '+7m' },
    {
      action: 'user',
      text: WARMUP_2_TEXT,
      script: [
        {
          text: WARMUP_2_REPLY,
          toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 10, weight: 40, setKind: 'warmup' } },
        },
        { text: WARMUP_2_FOLLOWUP },
      ],
    },
    { action: 'advance', at: '+9m' },
    {
      action: 'user',
      text: WORKING_TEXT,
      script: [
        {
          text: WORKING_REPLY,
          toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 10, weight: 60 } },
        },
        { text: WORKING_FOLLOWUP },
      ],
    },
    { action: 'advance', at: '+2m' },
    // A trivial extra turn — the WORKOUT OVERVIEW a step sees is assembled from state committed by
    // EARLIER steps, so the post-3rd-set guide/ACTIVE STATUS text only shows up here.
    { action: 'user', text: NEXT_TEXT, script: [{ text: NEXT_REPLY }] },
  ],
};

describe('set-kind — scripted training scenario (set-kind plan D2, D3, D4, AC-SK-1, AC-SK-2)', () => {
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
            .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')))
            .join('\n'),
        );
      },
    });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('session_sets.set_kind records warmup, warmup, working in order (AC-SK-1)', () => {
    const session = result.steps[WORKING_STEP_INDEX]!.sessions[0]!;
    const benchEx = session.exercises.find(ex => ex.exerciseId === BENCH_PRESS_ID)!;
    const kinds = benchEx.sets.map(s => s.setKind);

    expect(kinds).toEqual(['warmup', 'warmup', 'working']);
  });

  it('the confirmation names the first warm-up set "(warm-up)" (AC-SK-1)', () => {
    const seen = seenByStep.get(WARMUP_1_STEP_INDEX) ?? '';

    expect(seen).toContain('(warm-up)');
  });

  it('the working-set confirmation ("Set 3 logged") never says "(warm-up)"', () => {
    // The full context also carries the earlier warm-up confirmations (conversation history),
    // so this checks the text right around "Set 3 logged" specifically, not the whole context.
    const seen = seenByStep.get(WORKING_STEP_INDEX) ?? '';
    const idx = seen.lastIndexOf('Set 3 logged');

    expect(idx).toBeGreaterThan(-1);
    expect(seen.slice(idx, idx + 80)).not.toContain('(warm-up)');
  });

  it('the next turn\'s guide counts only the working set against the target — "(1/3 sets)" (AC-SK-2)', () => {
    const seen = seenByStep.get(NEXT_STEP_INDEX) ?? '';

    expect(seen).toContain('(1/3 sets)');
    expect(seen).not.toContain('(3/3 sets)');
  });

  it('the next turn\'s ACTIVE STATUS reports 1 set done, 2 remaining per plan (AC-SK-2)', () => {
    const seen = seenByStep.get(NEXT_STEP_INDEX) ?? '';

    expect(seen).toContain('1 set(s) done, 2 remaining per plan.');
  });

  it('the next turn\'s EXERCISE DETAIL lists all three sets, warm-ups marked (w/u) (AC-SK-2)', () => {
    const seen = seenByStep.get(NEXT_STEP_INDEX) ?? '';
    const lines = seen.split('\n');
    const set1Line = lines.find(l => l.includes('Set 1 ('));
    const set3Line = lines.find(l => l.includes('Set 3 ('));

    expect(set1Line).toContain('(w/u)');
    expect(set3Line).not.toContain('(w/u)');
  });

  it('delivers the scripted replies', () => {
    expect(result.steps[WARMUP_1_STEP_INDEX]!.delivered).toContain(WARMUP_1_REPLY);
    expect(result.steps[WORKING_STEP_INDEX]!.delivered).toContain(WORKING_REPLY);
  });
});
