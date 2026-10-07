import type { Scenario } from '../schema/scenario.schema';
import { predictNextLoad, type OracleVerdict } from '../lib/weight-oracle';

/**
 * The n-load-* journey family (coach-quality-proof T2 / AC-CQ-2): six seeded
 * history patterns, one exercise each, where the expected next load is
 * COMPUTED by the weight oracle (evals/lib/weight-oracle.ts) from the seeded
 * history — never hand-typed — and the scripted coach reply plus the logged
 * report set are both built from that verdict.
 *
 * The journeys pin the plane the deterministic layer can see: the training
 * request's `# History` rows (dates, sets, loads used — the dated facts the
 * live coach computes its proposal from). What a REAL model replies is T3's
 * to measure against `nLoadExpectations()`.
 *
 * The scripted `start_training_session` must name fixed exercise ids, so the
 * six patterns run on the test setup's two fixed barbell exercises
 * (src/app/test/setup.ts), alternating; distinctness lives in the histories,
 * and every scenario run is a fresh user.
 */

/** Fixed test-catalog exercise IDs (src/app/test/setup.ts). */
export const N_BENCH_PRESS_ID = 'c7b0899c-a0f9-47ca-a69d-4bcd531b0c95';
export const N_SQUAT_ID = '3818f94a-0543-4241-83b4-6840d06a4e6a';

/** One seeded workout of a case's history (the scenario schema's strength sets). */
export interface NLoadWorkout {
  at: string;
  sets: Array<{ reps: number; weight?: number; rpe?: number }>;
}

export interface NLoadCase {
  id: string;
  /** The pattern's one-line name, e.g. 'all sets at the top of the range twice'. */
  pattern: string;
  exerciseName: string;
  exerciseId: string;
  sessionKey: string;
  sessionTitle: string;
  range: { floor: number; top: number };
  /** The exercise's seeded performances, OLDEST FIRST (the past.workouts order). */
  workouts: NLoadWorkout[];
  /** Calendar days between the newest performance and the journey's T0. */
  gapDays: number;
  askText: string;
  /** Builds the scripted coach reply from the computed verdict. */
  proposal: (kg: number | null) => string;
  reportText: string;
  reportReps: number;
  /** The weight the report step logs; defaults to the verdict's expectedKg. */
  reportWeight?: number;
  /** `# History` rows the ask step's request must carry (pinned to the deterministic T0). */
  historyRows: string[];
  /** `# Today` rows the ask step's request must carry. */
  todayRows: string[];
  /** The Today row after the report set is logged (the `in progress:` line). */
  todayAfterReport: string;
  /** Extra `seen.mustNotMatch` entries for the ask step (case 6 has no past workouts). */
  seenMustNot?: string[];
}

/** The oracle verdict of one case — computed from its seeded history at read time. */
export function verdictOf(c: NLoadCase): OracleVerdict {
  return predictNextLoad({
    // Newest first, the order findRecentPerformancesForExercise returns.
    performances: [...c.workouts].reverse().map(w => ({ sets: w.sets })),
    range: c.range,
    equipment: 'barbell',
    gapDays: c.gapDays,
  });
}

/** What the T3 live run judges a coach reply against, per case. */
export interface NLoadExpectation {
  scenarioId: string;
  exercise: string;
  direction: OracleVerdict['direction'];
  expectedKg: number | null;
  acceptableKg: number[];
  reason: string;
}

/**
 * The T3 helper: {exercise, expectedKg | ask} per case, computed — the live
 * judge extracts the coach's proposed load and compares it against this.
 */
export function nLoadExpectations(): NLoadExpectation[] {
  return N_LOAD_CASES.map(c => {
    const v = verdictOf(c);
    return {
      scenarioId: c.id,
      exercise: c.exerciseName,
      direction: v.direction,
      expectedKg: v.expectedKg,
      acceptableKg: v.acceptableKg,
      reason: v.reason,
    };
  });
}

const USER: Scenario['past']['user'] = {
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
};

const GREETING_REQUEST = 'привет, хочу потренироваться';
const GREETING_AND_TRANSITION_TEXT = 'Привет, Алекс! Отлично, давай подберём тренировку.';
const PLANNING_FINAL_TEXT = 'Перешли к планированию. Какую группу сегодня нагружаем?';
const LETS_GO = 'да, поехали';

/** Builds the whole journey of one case: setup to training, the ask, the report. */
export function nLoadScenarioOf(c: NLoadCase): Scenario {
  const verdict = verdictOf(c);
  const expectedKg = verdict.expectedKg;
  const reportWeight = c.reportWeight ?? expectedKg;
  if (reportWeight == null) {
    throw new Error(`n-load case ${c.id}: no report weight (verdict ${verdict.direction} has no expectedKg)`);
  }
  const planText = `3×${c.range.floor}-${c.range.top}`;
  const startFinalText = `Поехали! Начнём с ${c.exerciseName === 'Barbell Bench Press' ? 'жима лёжа' : 'приседа'}: ${planText}, вес подберём по ходу.`;
  const proposalText = c.proposal(expectedKg);
  const loggedText = 'Записал!';
  const afterReportText = 'Принято, пошли дальше.';

  return {
    id: c.id,
    description: `${c.pattern} — the ask and the report turn; expected ${verdict.direction}` +
      (expectedKg != null ? ` ${expectedKg} kg (${verdict.reason})` : ` (${verdict.reason})`),
    past: {
      user: USER,
      facts: [],
      plan: {
        name: 'Single Exercise Progression',
        sessions: [
          {
            key: c.sessionKey,
            title: c.sessionTitle,
            exercises: [{ exercise: c.exerciseName, sets: 3, reps: `${c.range.floor}-${c.range.top}` }],
          },
        ],
      },
      workouts: c.workouts.map(w => ({
        at: w.at,
        key: c.sessionKey,
        exercises: [{ exercise: c.exerciseName, sets: w.sets }],
      })),
    },
    steps: [
      // --- step 0: greeting, chat → session_planning ---
      {
        action: 'user',
        text: GREETING_REQUEST,
        script: [
          {
            text: GREETING_AND_TRANSITION_TEXT,
            toolCall: { name: 'request_transition', args: { toPhase: 'session_planning', reason: 'user wants to train' } },
          },
          { text: PLANNING_FINAL_TEXT },
        ],
        expect: {
          tools: { must: ['request_transition'] },
          delivered: { mustMatch: [PLANNING_FINAL_TEXT] },
          persisted: { turnRecorded: true },
          phaseAfter: { phase: 'session_planning' },
        },
      },
      // --- step 1: start_training_session with the plan exercise ---
      {
        action: 'user',
        text: LETS_GO,
        script: [
          {
            toolCall: {
              name: 'start_training_session',
              args: {
                sessionKey: c.sessionKey,
                sessionName: c.sessionTitle,
                reasoning: 'The active plan has one session; the user is ready to start.',
                exercises: [
                  {
                    exerciseId: c.exerciseId,
                    exerciseName: c.exerciseName,
                    targetSets: 3,
                    targetReps: `${c.range.floor}-${c.range.top}`,
                    restSeconds: 120,
                  },
                ],
                estimatedDuration: 45,
              },
            },
          },
          { text: startFinalText },
        ],
        expect: {
          tools: { must: ['start_training_session'] },
          delivered: { mustMatch: ['Поехали!'] },
          phaseAfter: { phase: 'training' },
          persisted: { session: { key: c.sessionKey, status: 'in_progress', hasStartedAt: true } },
        },
      },
      { action: 'advance', at: '+5m' },
      // --- step 3: the ask — the first training turn carries the History rows ---
      {
        action: 'user',
        text: c.askText,
        script: [{ text: proposalText }],
        expect: {
          seen: {
            mustMatch: ['# Today (sets as reps×kg)', ...c.todayRows, '# History (before today)', ...c.historyRows],
            ...(c.seenMustNot ? { mustNotMatch: c.seenMustNot } : {}),
          },
          // The ask turn logs nothing — there is nothing to log yet.
          tools: { mustNot: ['log_set'] },
          delivered: { mustMatch: [proposalText] },
          persisted: { turnRecorded: true },
          phaseAfter: { phase: 'training' },
        },
      },
      { action: 'advance', at: '+4m' },
      // --- step 5: the report — a set at the expected load, no ask before it ---
      {
        action: 'user',
        text: c.reportText,
        script: [
          {
            text: loggedText,
            toolCall: {
              name: 'log_set',
              args: { exerciseId: c.exerciseId, reps: c.reportReps, weight: reportWeight },
            },
          },
          { text: afterReportText },
        ],
        expect: {
          seen: { mustMatch: [c.todayAfterReport] },
          tools: { must: ['log_set'] },
          delivered: { mustMatch: [loggedText, afterReportText] },
          persisted: {
            session: {
              key: c.sessionKey,
              status: 'in_progress',
              exercises: [{ exercise: c.exerciseName, sets: [{ reps: c.reportReps, weight: reportWeight }] }],
            },
          },
          phaseAfter: { phase: 'training' },
        },
      },
    ],
  };
}

/**
 * The six seeded patterns (plan § T2). History dates are relative to T0; the
 * pinned `historyRows`/`todayRows` strings assume the deterministic layer's
 * T0 = 2026-09-20T10:00:00.000Z (a Sunday in Europe/Berlin) — the same T0 the
 * integration test pins.
 */
export const N_LOAD_CASES: NLoadCase[] = [
  {
    id: 'n-load-up',
    pattern: 'all sets at the top of the range twice — one step up',
    exerciseName: 'Barbell Bench Press',
    exerciseId: N_BENCH_PRESS_ID,
    sessionKey: 'upper_a',
    sessionTitle: 'Upper A',
    range: { floor: 8, top: 10 },
    workouts: [
      { at: '-8d', sets: [{ reps: 8, weight: 77.5 }, { reps: 8, weight: 77.5 }, { reps: 8, weight: 77.5 }] },
      { at: '-5d', sets: [{ reps: 10, weight: 80, rpe: 8 }, { reps: 10, weight: 80, rpe: 8 }, { reps: 10, weight: 80, rpe: 8 }] },
      { at: '-2d', sets: [{ reps: 10, weight: 80, rpe: 8 }, { reps: 10, weight: 80, rpe: 8 }, { reps: 10, weight: 80, rpe: 8 }] },
    ],
    gapDays: 2,
    askText: 'какой вес взять на жим?',
    proposal: kg => `Бери ${kg} кг: две тренировки подряд все подходы по 10 с запасом — пора шагнуть вверх.`,
    reportText: 'сделал 82.5 на 10',
    reportReps: 10,
    todayRows: [
      'Previous workout: 2 days ago, Friday Sep 18 — Barbell Bench Press.',
      `- Barbell Bench Press [id ${N_BENCH_PRESS_ID}] — plan 3×8-10 — nothing yet`,
    ],
    historyRows: [
      'Barbell Bench Press (today 3×8-10)',
      '- 2 days ago, Friday Sep 18: 10×80, 10×80, 10×80 (all RPE 8)',
      '- 5 days ago, Tuesday Sep 15: 10×80, 10×80, 10×80 (all RPE 8)',
      '- 8 days ago, Saturday Sep 12: 8×77.5, 8×77.5, 8×77.5 (no RPE recorded)',
      'Trend Sep 12 → Sep 15 → Sep 18:',
      '- Loads used: 77.5, 80 kg.',
    ],
    todayAfterReport: `- Barbell Bench Press [id ${N_BENCH_PRESS_ID}] — plan 3×8-10 — in progress: 10×82.5`,
  },
  {
    id: 'n-load-miss',
    pattern: 'a miss below the floor even by capacity — one step down',
    exerciseName: 'Barbell Back Squat',
    exerciseId: N_SQUAT_ID,
    sessionKey: 'lower_a',
    sessionTitle: 'Lower A',
    range: { floor: 8, top: 10 },
    workouts: [
      { at: '-8d', sets: [{ reps: 8, weight: 97.5 }, { reps: 8, weight: 97.5 }, { reps: 8, weight: 97.5 }] },
      { at: '-5d', sets: [{ reps: 9, weight: 100 }, { reps: 9, weight: 100 }, { reps: 9, weight: 100 }] },
      { at: '-2d', sets: [{ reps: 6, weight: 100, rpe: 9 }, { reps: 6, weight: 100, rpe: 9 }, { reps: 6, weight: 100, rpe: 9 }] },
    ],
    gapDays: 2,
    askText: 'с каким весом приседать?',
    proposal: kg => `Давай ${kg} кг: на 100 в прошлый раз все подходы вышли только по 6 — скинем шаг и вернёмся, когда снова пойдёт по 9.`,
    reportText: 'сделал 97.5 на 9',
    reportReps: 9,
    todayRows: [
      'Previous workout: 2 days ago, Friday Sep 18 — Barbell Back Squat.',
      `- Barbell Back Squat [id ${N_SQUAT_ID}] — plan 3×8-10 — nothing yet`,
    ],
    historyRows: [
      'Barbell Back Squat (today 3×8-10)',
      '- 2 days ago, Friday Sep 18: 6×100, 6×100, 6×100 (all RPE 9)',
      '- 5 days ago, Tuesday Sep 15: 9×100, 9×100, 9×100 (no RPE recorded)',
      '- 8 days ago, Saturday Sep 12: 8×97.5, 8×97.5, 8×97.5 (no RPE recorded)',
      'Trend Sep 12 → Sep 15 → Sep 18:',
      '- Loads used: 97.5, 100 kg.',
    ],
    todayAfterReport: `- Barbell Back Squat [id ${N_SQUAT_ID}] — plan 3×8-10 — in progress: 9×97.5`,
  },
  {
    id: 'n-load-early-stop',
    pattern: 'an early stop below the floor by reps but not by capacity (RPE ≤ 7) — hold',
    exerciseName: 'Barbell Bench Press',
    exerciseId: N_BENCH_PRESS_ID,
    sessionKey: 'upper_a',
    sessionTitle: 'Upper A',
    range: { floor: 8, top: 10 },
    workouts: [
      { at: '-8d', sets: [{ reps: 8, weight: 77.5 }, { reps: 8, weight: 77.5 }, { reps: 8, weight: 77.5 }] },
      { at: '-5d', sets: [{ reps: 8, weight: 80 }, { reps: 8, weight: 80 }, { reps: 8, weight: 80 }] },
      { at: '-2d', sets: [{ reps: 6, weight: 80, rpe: 7 }, { reps: 6, weight: 80, rpe: 7 }, { reps: 6, weight: 80, rpe: 7 }] },
    ],
    gapDays: 2,
    askText: 'какой вес на жим сегодня?',
    proposal: kg => `Оставайся на ${kg} кг: в прошлый раз дошёл только до 6, но с запасом (RPE 7) — это ранняя остановка, не провал. Сделай все подходы по 8-10 и добавим.`,
    reportText: 'сделал 80 на 8',
    reportReps: 8,
    todayRows: [
      'Previous workout: 2 days ago, Friday Sep 18 — Barbell Bench Press.',
      `- Barbell Bench Press [id ${N_BENCH_PRESS_ID}] — plan 3×8-10 — nothing yet`,
    ],
    historyRows: [
      'Barbell Bench Press (today 3×8-10)',
      '- 2 days ago, Friday Sep 18: 6×80, 6×80, 6×80 (all RPE 7)',
      '- 5 days ago, Tuesday Sep 15: 8×80, 8×80, 8×80 (no RPE recorded)',
      '- 8 days ago, Saturday Sep 12: 8×77.5, 8×77.5, 8×77.5 (no RPE recorded)',
      'Trend Sep 12 → Sep 15 → Sep 18:',
      '- Loads used: 77.5, 80 kg.',
    ],
    todayAfterReport: `- Barbell Bench Press [id ${N_BENCH_PRESS_ID}] — plan 3×8-10 — in progress: 8×80`,
  },
  {
    id: 'n-load-break',
    pattern: 'a 3-week break — the return ladder, one step down (owner-unconfirmed alternative ~10 % lighter)',
    exerciseName: 'Barbell Back Squat',
    exerciseId: N_SQUAT_ID,
    sessionKey: 'lower_a',
    sessionTitle: 'Lower A',
    range: { floor: 8, top: 10 },
    workouts: [
      { at: '-24d', sets: [{ reps: 8, weight: 97.5 }, { reps: 8, weight: 97.5 }, { reps: 8, weight: 97.5 }] },
      { at: '-21d', sets: [{ reps: 9, weight: 100 }, { reps: 9, weight: 100 }, { reps: 9, weight: 100 }] },
    ],
    gapDays: 21,
    askText: 'после перерыва, какой вес на присед?',
    proposal: kg => `После трёх недель без тренировок начнём осторожно: ${kg} кг вместо 100, к рабочему весу вернёмся за одну-две тренировки.`,
    reportText: 'сделал 97.5 на 9',
    reportReps: 9,
    todayRows: [
      'Previous workout: 21 days ago, Sunday Aug 30 — Barbell Back Squat.',
      `- Barbell Back Squat [id ${N_SQUAT_ID}] — plan 3×8-10 — nothing yet`,
    ],
    historyRows: [
      'Barbell Back Squat (today 3×8-10)',
      '- 21 days ago, Sunday Aug 30: 9×100, 9×100, 9×100 (no RPE recorded)',
      '- 24 days ago, Thursday Aug 27: 8×97.5, 8×97.5, 8×97.5 (no RPE recorded)',
      'Trend Aug 27 → Aug 30:',
      '- Loads used: 97.5, 100 kg.',
    ],
    todayAfterReport: `- Barbell Back Squat [id ${N_SQUAT_ID}] — plan 3×8-10 — in progress: 9×97.5`,
  },
  {
    id: 'n-load-uneven',
    pattern: 'an uneven drop-off — hold, neither growth nor a step down',
    exerciseName: 'Barbell Bench Press',
    exerciseId: N_BENCH_PRESS_ID,
    sessionKey: 'upper_a',
    sessionTitle: 'Upper A',
    range: { floor: 8, top: 10 },
    workouts: [
      { at: '-7d', sets: [{ reps: 10, weight: 80 }, { reps: 10, weight: 80 }, { reps: 10, weight: 80 }] },
      { at: '-2d', sets: [{ reps: 10, weight: 80 }, { reps: 10, weight: 80 }, { reps: 4, weight: 80 }] },
    ],
    gapDays: 2,
    askText: 'какой вес на жим брать?',
    proposal: kg => `Сегодня снова ${kg} кг: в пятницу последний подход просел до 4 повторов — выровняй все три по 10, потом добавим.`,
    reportText: 'сделал 80 на 10',
    reportReps: 10,
    todayRows: [
      'Previous workout: 2 days ago, Friday Sep 18 — Barbell Bench Press.',
      `- Barbell Bench Press [id ${N_BENCH_PRESS_ID}] — plan 3×8-10 — nothing yet`,
    ],
    historyRows: [
      'Barbell Bench Press (today 3×8-10)',
      '- 2 days ago, Friday Sep 18: 10×80, 10×80, 4×80 (no RPE recorded)',
      '- 7 days ago, Sunday Sep 13: 10×80, 10×80, 10×80 (no RPE recorded)',
      'Trend Sep 13 → Sep 18:',
      '- Loads used: 80 kg.',
    ],
    todayAfterReport: `- Barbell Bench Press [id ${N_BENCH_PRESS_ID}] — plan 3×8-10 — in progress: 10×80`,
  },
  {
    id: 'n-load-ask',
    pattern: 'no history — no number, the coach asks',
    exerciseName: 'Barbell Back Squat',
    exerciseId: N_SQUAT_ID,
    sessionKey: 'lower_a',
    sessionTitle: 'Lower A',
    range: { floor: 8, top: 10 },
    workouts: [],
    gapDays: 0,
    askText: 'а какой вес на присед?',
    proposal: () => 'Мы с тобой ещё не приседали. С каким весом обычно работаешь? Если давно не тренировался — начнём с лёгкого.',
    reportText: 'ну, пусть 50 на 10',
    reportReps: 10,
    reportWeight: 50,
    todayRows: [`- Barbell Back Squat [id ${N_SQUAT_ID}] — plan 3×8-10 — nothing yet`],
    historyRows: ['Barbell Back Squat (today 3×8-10)', '- no earlier record'],
    todayAfterReport: `- Barbell Back Squat [id ${N_SQUAT_ID}] — plan 3×8-10 — in progress: 10×50`,
    seenMustNot: ['Previous workout:', 'Loads used:'],
  },
];
