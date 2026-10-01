/**
 * AC-LPF-12 (b): the independent golden table (60 cases, written from the sources and the plan text only, without code
 * access) run against the real domain code and the real v2 block text.
 *
 * Mapping (documented, the fixture is never edited):
 *  - history → performances (days_ago → the performance date; `kind: "working"` → explicit working set, `null` → legacy
 *    NULL kind; weight 0 → a bodyweight set without a load; per-hand dumbbells → `perHand` sets; `step_kg: null` on a
 *    non-bodyweight exercise → equipment `none` = the catalog step is unknown); the plan target is the rep range.
 *  - today → `days_since_last_workout_any` becomes the one workout of the gap fact; a short constraint on the primary /
 *    the secondary-only muscle; material pre-fatigue = four earlier working sets on the primary muscle today.
 *  - the ladder / break reason are derived exactly as the loader does (`ladderStateOf` over the history; the case's
 *    `break_reason`, else `unknown`).
 *  - `decision`: grow = scheme_growth | early_growth; step_down = below_floor; ladder = the three gap rows;
 *    insufficient_reference / no_number = insufficient_data with / without a number; hold = every other row that keeps
 *    the working weight (scheme_hold, early_stop, unclear_effort, uneven_performance, short_constraint, pre_fatigue).
 *  - `working_weight_kg`, `recommend_kg`, `conservative_kg`, `conservative_is_floor_no_lighter` (the block prints
 *    "no lighter option"), `reps`, `confidence` / `confidence_max`, `estimated_from`, `missing_contains`,
 *    `volume_line` and `ask_effort` are asserted exactly.
 *  - `next_step_gist` is an INTENT check on the printed `next step:` line: the gist selects an intent class by keyword,
 *    the line must belong to that class and carry every number of the gist (a gist number may be the load as a bare
 *    figure — "62.5" — the line prints "62.5 kg"). `reason_contains` is a case-insensitive substring of the reason.
 *  - `must_not` is documentation: every entry the code can mechanically violate (a load, a decision word) is already
 *    excluded by the exact equalities above.
 *  - "ambiguous" cases are asserted against the RULINGS (plan § Golden-table rulings); the ruling id is in the title
 *    and the override below says what differs from the table.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  computeLoadFacts,
  type ExerciseInput,
  isAbsent,
  type LoadFacts,
  type OtherSetInput,
  type PerformanceInput,
  type SetInput,
} from '@domain/training/load-facts';
import { daysBefore, NOW } from '@domain/training/load-facts/__tests__/fixtures';
import {
  defaultProgression,
  type Decision,
  ladderPerformancesOf,
  ladderStateOf,
  type BreakReason,
} from '@domain/training/load-plan';

import { decideLoadPlanEntry } from '@infra/ai/load-facts/load-decision';
import type { LoadPlanEntry } from '@infra/ai/load-facts/load-facts.loader';

import { renderLoadPlanEntryV2 } from '../training-load-plan.v2';

interface GoldenSet {
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  kind: 'working' | 'warmup' | null;
}
interface GoldenCase {
  id: string;
  title: string;
  exercise: { name: string; equipment: string; step_kg: number | null; per_hand: boolean };
  rep_range: { min: number; max: number };
  history: { days_ago: number; sets: GoldenSet[] }[];
  today: {
    days_since_last_workout_any: number;
    short_constraint_primary: boolean;
    short_constraint_secondary_only?: boolean;
    pre_fatigue_material: boolean;
    break_reason?: string;
  };
  expected: {
    working_weight_kg: number | null;
    decision: string;
    recommend_kg: number | null;
    conservative_kg: number | null;
    conservative_is_floor_no_lighter: boolean;
    next_step_gist: string;
    reps?: string;
    confidence?: string;
    confidence_max?: string;
    estimated_from?: string;
    missing_contains?: string;
    volume_line?: string;
    ask_effort?: boolean;
    reason_contains?: string;
  };
  confidence: 'certain' | 'ambiguous';
}

const TABLE: GoldenCase[] = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../../../../../domain/training/load-plan/__tests__/fixtures/golden-table.json'),
    'utf8',
  ),
);

/** Where the ruling (not the table) decides: ruling id → the expected fields that differ from the table. */
const RULINGS: Record<string, { ruling: string; expected: Partial<GoldenCase['expected']> }> = {
  // Any number of below-floor sets without RPE → hold + ask the first time (the table said step down).
  'G-07': {
    ruling: 'G-06/07',
    expected: {
      decision: 'hold',
      recommend_kg: 60,
      conservative_kg: 57.5,
      next_step_gist: 'ask the effort; the load stays at 60 unless 0-2 reps were left',
      ask_effort: true,
    },
  },
  // One performance: the insufficient-data load is the working-weight value (the estimate), not the failed opener.
  'G-11': { ruling: 'G-11', expected: { recommend_kg: 50, conservative_kg: 45 } },
  // "Recovered" = gap tier rest OR rest_with_question: 9 d off this exercise no longer blocks one-session growth.
  'G-15': {
    ruling: 'G-15',
    expected: {
      decision: 'grow',
      recommend_kg: 55,
      conservative_kg: 50,
      reps: '8-10',
      next_step_gist: 'sets at 55 in range',
    },
  },
  // A short constraint keeps W-2 (one step down, floored) and the reason adds "or skip / substitute".
  'G-16': {
    ruling: 'G-16',
    expected: {
      conservative_kg: 45,
      reason_contains: 'skip / substitute',
      next_step_gist: 'growth resumes when the constraint closes',
    },
  },
  // Growth is blocked by a short constraint on a PRIMARY muscle only; a secondary-only constraint does not block it.
  'G-17': {
    ruling: 'G-17',
    expected: {
      decision: 'grow',
      recommend_kg: 55,
      conservative_kg: 50,
      reps: '8-10',
      next_step_gist: 'sets at 55 in range',
    },
  },
  // O-2: the 10 % cap does not apply to a machine whose own weight is not in the displayed load → growth is named.
  // Run 5 R3 (W-37) + W-38: only a CONFIRMED step counts, so the lateral raise shape has an UNKNOWN step. Growth then
  // goes to the nearest RECORDED heavier load: G-32 has a 5 kg set on record (next step names 5 kg, as the table says);
  // G-33's history is 2.5 kg only — nothing heavier on record, so no growth and no number: "ask which heavier load".
  'G-32': { ruling: 'W-38 recorded heavier load', expected: { next_step_gist: 'last set >= 14 twice -> growth (5)' } },
  'G-33': {
    ruling: 'W-37/W-38 unknown step, no heavier on record',
    expected: {
      decision: 'hold',
      recommend_kg: 2.5,
      conservative_kg: 2.5,
      conservative_is_floor_no_lighter: true,
      next_step_gist: 'growth needs a known equipment step',
      reason_contains: '',
    },
  },
  // Run 3 (orchestrator ruling): when the 10 % cap blocks a met growth condition the SMALLEST step is offered, reps
  // reset to the floor (NSCA smallest increment) — no dead end. Moves two table rows (G-40 "certain", G-60).
  'G-40': {
    ruling: 'run 3 smallest step under the cap',
    expected: {
      decision: 'grow',
      recommend_kg: 10,
      conservative_kg: 8,
      reps: '10-10',
      next_step_gist: 'sets at 10 in range',
      reason_contains: 'smallest step',
    },
  },
  'G-60': {
    ruling: 'run 3 smallest step under the cap',
    expected: {
      decision: 'grow',
      recommend_kg: 22.5,
      conservative_kg: 20,
      reps: '8-8',
      next_step_gist: 'sets at 22.5 in range',
      reason_contains: 'smallest step',
    },
  },
  // Orchestrator ruling 2026-10-01 (1): the insufficient-data rebuild start follows the break ladder — two steps below.
  'G-47': { ruling: 'rebuild ladder 2 steps', expected: { recommend_kg: 35, conservative_kg: 32.5 } },
  // O-3: after a restart the start is never lighter than after a rebuild: two steps below, then the ladder.
  'G-46': {
    ruling: 'O-3',
    expected: { recommend_kg: 55, conservative_kg: 52.5, next_step_gist: 'restart: 2 more workouts -> back to 60' },
  },
};

const ctx = { now: NOW, timezone: null, user: null };
const progression = defaultProgression(null);

const rangeText = (r: { min: number; max: number }): string => (r.min === r.max ? `${r.min}` : `${r.min}-${r.max}`);

function exerciseOf(c: GoldenCase): ExerciseInput {
  const unknownStep = c.exercise.step_kg === null && c.exercise.equipment !== 'bodyweight';
  return {
    id: 'ex-golden',
    name: c.exercise.name,
    exerciseType: c.exercise.name === 'Plank' ? 'isometric' : 'strength',
    equipment: (unknownStep ? 'none' : c.exercise.equipment) as ExerciseInput['equipment'],
    muscles: [
      { muscleGroup: 'chest', involvement: 'primary' },
      { muscleGroup: 'triceps', involvement: 'secondary' },
    ],
  };
}

function setOf(c: GoldenCase, s: GoldenSet, at: Date): SetInput {
  const common = { rpe: s.rpe, userFeedback: null, createdAt: at, setKind: s.kind };
  if (c.exercise.name === 'Plank') {
    return { ...common, setData: { type: 'isometric', duration: 45 } };
  }
  const weighted = s.weight_kg !== null && s.weight_kg > 0;
  return {
    ...common,
    setData: {
      type: 'strength',
      reps: s.reps ?? 0,
      ...(weighted ? { weight: s.weight_kg as number, weightUnit: 'kg' as const } : {}),
      ...(weighted && c.exercise.per_hand ? { perHand: true } : {}),
    },
  };
}

function otherSetsToday(): OtherSetInput[] {
  return Array.from({ length: 4 }, (_v, i) => ({
    exerciseRowId: 'row-other',
    exerciseName: 'Earlier chest exercise',
    setData: { type: 'strength' as const, reps: 10, weight: 40 },
    muscles: [{ muscleGroup: 'chest' as const, involvement: 'primary' as const }],
    setKind: 'working' as const,
    createdAt: new Date(NOW.getTime() - (10 - i) * 120_000),
  }));
}

export function entryOf(c: GoldenCase): { entry: LoadPlanEntry; facts: LoadFacts } {
  const exercise = exerciseOf(c);
  const performances: PerformanceInput[] = c.history.map((h, i) => {
    const performedAt = daysBefore(h.days_ago);
    return {
      id: `p${i}`,
      sessionId: `s${i}`,
      place: null,
      startedAt: new Date(performedAt.getTime() - 3_600_000),
      performedAt,
      targetReps: rangeText(c.rep_range),
      sets: h.sets.map((s, n) => setOf(c, s, new Date(performedAt.getTime() + n * 120_000))),
      otherSets: [],
    };
  });
  const constraints = [
    ...(c.today.short_constraint_primary
      ? [{ muscleGroup: 'chest' as const, durability: 'short' as const, text: 'sore shoulder' }]
      : []),
    ...(c.today.short_constraint_secondary_only
      ? [{ muscleGroup: 'triceps' as const, durability: 'short' as const, text: 'sore elbow' }]
      : []),
  ];
  const facts = computeLoadFacts(
    exercise,
    performances,
    {
      sessionId: 'today',
      place: null,
      startedAt: new Date(NOW.getTime() - 40 * 60_000),
      targetReps: rangeText(c.rep_range),
      sets: [],
      otherSets: c.today.pre_fatigue_material ? otherSetsToday() : [],
    },
    {
      constraints,
      equipmentFacts: [],
      workouts: [
        { sessionId: 'w-any', performedAt: daysBefore(c.today.days_since_last_workout_any), primaryMuscles: [] },
      ],
    },
    NOW,
    null,
  );
  const entry: LoadPlanEntry = {
    exercise,
    facts,
    returnBranch: {
      ladder: ladderStateOf(ladderPerformancesOf(performances, 'today'), null),
      breakReason: (c.today.break_reason ?? 'unknown') as BreakReason,
    },
  };
  return { entry, facts };
}

function decisionClass(d: Decision): string {
  switch (d.row) {
    case 'scheme_growth':
    case 'early_growth':
      return 'grow';
    case 'below_floor':
      return 'step_down';
    case 'gap_return':
    case 'gap_rebuild':
    case 'gap_restart':
      return 'ladder';
    case 'insufficient_data':
      return d.candidate.load === null ? 'no_number' : 'insufficient_reference';
    default:
      return 'hold';
  }
}

/** Intent classes of a gist → the NextStep kinds that belong to it. */
const INTENTS: [RegExp, string[]][] = [
  [/take it to the floor/i, ['early_stop']],
  [/ask the effort/i, ['ask_effort']],
  [/back to [\d.]+ when the sets at/i, ['step_down']],
  [/more workouts?|rebuild|ladder|restart/i, ['ladder']],
  [/even sets/i, ['uneven']],
  [/constraint closes|growth resumes|growth when the constraint/i, ['constraint']],
  [/fresh order/i, ['pre_fatigue']],
  [/progress by (reps|hold time)/i, ['reps_only', 'hold']],
  [/known equipment step/i, ['hold', 'ask_heavier']],
  [/log (it|this exercise)/i, ['insufficient', 'no_number']],
  [/confirm it, then the growth rule|reaching 8\+ reps confirm|reaching 8\+ confirm/i, ['estimated']],
  [/in range( confirm)?$|sets at [\d.]+ (per hand )?in range/i, ['after_growth']],
  [/^sets at [\d.]+ reaching \d+-\d+/i, ['after_growth']],
  [/last set|reaching the range top|\+2 reps|>= \d+/i, ['growth']],
];

function intentKinds(gist: string): string[] | null {
  return INTENTS.find(([re]) => re.test(gist))?.[1] ?? null;
}

/**
 * Numbers a gist commits to: every load and every threshold (a number > 10 or with a decimal point) must appear in the
 * printed `next step:` line — including the one-session alternative a gist names. Ask / ladder-count / constraint /
 * uneven wording carries no numeric commitment.
 */
function committedNumbers(gist: string, kinds: string[]): string[] {
  if (
    kinds.some(k =>
      ['ask_effort', 'hold', 'ask_heavier', 'insufficient', 'no_number', 'constraint', 'uneven'].includes(k),
    )
  ) {
    return [];
  }
  return (gist.match(/\d+(?:\.\d+)?/g) ?? []).filter(n => Number(n) > 10 || n.includes('.'));
}

const LEVELS = ['low', 'medium', 'high'];

describe('AC-LPF-12 · golden table (independent, 60 cases)', () => {
  it('has the 60 cases of the fixture', () => {
    expect(TABLE).toHaveLength(60);
    expect(new Set(TABLE.map(c => c.id)).size).toBe(60);
  });

  describe.each(TABLE)('$id $title', c => {
    const ruling = RULINGS[c.id];
    const e = { ...c.expected, ...(ruling?.expected ?? {}) };
    const title = ruling ? ` [ruling ${ruling.ruling}]` : '';

    it(`working weight, decision, recommend, conservative${title}`, () => {
      const { entry, facts } = entryOf(c);
      const d = decideLoadPlanEntry(entry, { progression });
      if (c.exercise.name === 'Plank') {
        expect(d).toBeNull();
        return;
      }
      if (d === null) {
        throw new Error('expected a decision');
      }
      const ww = isAbsent(facts.workingWeight) ? null : facts.workingWeight.weight;
      expect({
        workingWeight: ww,
        decision: decisionClass(d),
        recommend: d.candidate.load,
        conservative: d.conservative.load,
      }).toEqual({
        workingWeight: e.working_weight_kg,
        decision: e.decision,
        recommend: e.recommend_kg,
        conservative: e.conservative_kg,
      });
      if (e.reps !== undefined) {
        const [min, max] = e.reps.split('-').map(Number);
        expect(d.candidate.reps).toEqual({ min, max });
      }
    });

    it(`block text: floor flag, next step, reason, flags${title}`, () => {
      const { entry } = entryOf(c);
      const d = decideLoadPlanEntry(entry, { progression });
      if (d === null) {
        return;
      }
      const text = renderLoadPlanEntryV2(entry, ctx, { progression });
      const line = (key: string): string =>
        text
          .split('\n')
          .map(l => l.trim())
          .find(l => l.startsWith(`${key}:`)) ?? '';
      expect(line('conservative').includes('no lighter option')).toBe(e.conservative_is_floor_no_lighter);
      const next = line('next step');
      expect(next).not.toBe('');
      const kinds = intentKinds(e.next_step_gist);
      if (kinds === null) {
        throw new Error(`no intent class for the gist: ${e.next_step_gist}`);
      }
      expect(kinds).toContain(d.next.kind);
      for (const n of committedNumbers(e.next_step_gist, kinds)) {
        expect(next).toContain(n);
      }
      if (e.reason_contains) {
        expect(d.reason.toLowerCase()).toContain(e.reason_contains.toLowerCase());
      }
      if (e.confidence) {
        expect(d.confidence).toBe(e.confidence);
      }
      if (e.confidence_max) {
        expect(LEVELS.indexOf(d.confidence)).toBeLessThanOrEqual(LEVELS.indexOf(e.confidence_max));
      }
      if (e.estimated_from) {
        const w = entry.facts.workingWeight;
        expect(isAbsent(w) ? null : `${w.estimatedFrom?.weight}x${w.estimatedFrom?.reps}`).toBe(e.estimated_from);
      }
      if (e.missing_contains) {
        expect(d.missing).toContain(e.missing_contains);
      }
      if (e.volume_line) {
        expect(line('volume')).toContain(e.volume_line);
      }
      if (e.ask_effort) {
        expect(d.next.kind).toBe('ask_effort');
      }
    });
  });
});
