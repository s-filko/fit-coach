/**
 * The database plane of the fact-lifecycle journeys (course-check plan Task 3,
 * AC-FL-7) — pure evaluation shared by BOTH layers (the deterministic
 * integration test and L3), so the two can never disagree about what
 * "persisted" means. No I/O, no clock reads: the rows and T0 arrive as data;
 * the loaders live in run-scenario.ts.
 *
 * Why the database and not the prose: the 2026-09-21 dev smoke had the coach
 * announcing a retraction that never happened. A journey that only asserts what
 * the coach said proves nothing — the row's status, archive reason, closure
 * stamp, dates, confirmations and links are the ending.
 */
import { type FactRowExpect, type PlanRowExpect, resolveRelativeTime } from '../schema/scenario.schema';

/** Scenario clock drift between steps (fake time advances with real time) — dates match within this. */
export const DATE_TOLERANCE_MS = 10 * 60_000;

/** One `user_facts` row, reduced to what journeys assert on. */
export interface FactRowSnapshot {
  id: string;
  fact: string;
  status: 'active' | 'archived';
  archivedReason: 'user_closed' | 'expired' | 'superseded' | null;
  closedByUserAt: Date | null;
  durability: 'permanent' | 'long_term' | 'short';
  onExpiry: 'forget' | 'ask_once' | null;
  expiresAt: Date | null;
  reviewAfter: Date | null;
  phaseNote: string | null;
  confirmations: number;
  supersedesId: string | null;
}

/** One `workout_plans` row, reduced to its status and the exercise names inside plan_json. */
export interface PlanRowSnapshot {
  id: string;
  status: string;
  exerciseNames: string[];
}

export interface PersistedCheck {
  check: string;
  passed: boolean;
  detail?: string;
}

function describeRows(rows: FactRowSnapshot[]): string {
  return rows.length === 0
    ? 'no matching rows'
    : rows.map(r => `${r.status}${r.archivedReason ? `/${r.archivedReason}` : ''}: "${r.fact}"`).join('; ');
}

/** Field-by-field check of ONE row against an expectation; returns the failing field names with detail. */
function rowMismatches(row: FactRowSnapshot, expected: FactRowExpect, t0: Date): string[] {
  const bad: string[] = [];
  const dateOk = (actual: Date | null, want: string | null): boolean =>
    want === null
      ? actual === null
      : actual !== null && Math.abs(actual.getTime() - resolveRelativeTime(want, t0).getTime()) <= DATE_TOLERANCE_MS;

  if (expected.archivedReason !== undefined && row.archivedReason !== expected.archivedReason) {
    bad.push(`archivedReason ${row.archivedReason} ≠ ${expected.archivedReason}`);
  }
  if (expected.closedByUser !== undefined && (row.closedByUserAt !== null) !== expected.closedByUser) {
    bad.push(
      `closed_by_user_at ${row.closedByUserAt === null ? 'null' : 'set'}, expected ${expected.closedByUser ? 'set' : 'null'}`,
    );
  }
  if (expected.durability !== undefined && row.durability !== expected.durability) {
    bad.push(`durability ${row.durability} ≠ ${expected.durability}`);
  }
  if (expected.onExpiry !== undefined && row.onExpiry !== expected.onExpiry) {
    bad.push(`on_expiry ${row.onExpiry} ≠ ${expected.onExpiry}`);
  }
  if (expected.expiresAt !== undefined && !dateOk(row.expiresAt, expected.expiresAt)) {
    bad.push(`expires_at ${row.expiresAt?.toISOString() ?? 'null'} ≠ T0${expected.expiresAt ?? ' null'}`);
  }
  if (expected.reviewAfter !== undefined && !dateOk(row.reviewAfter, expected.reviewAfter)) {
    bad.push(`review_after ${row.reviewAfter?.toISOString() ?? 'null'} ≠ T0${expected.reviewAfter ?? ' null'}`);
  }
  if (expected.phaseNote !== undefined && row.phaseNote !== expected.phaseNote) {
    bad.push(`phase_note ${JSON.stringify(row.phaseNote)} ≠ ${JSON.stringify(expected.phaseNote)}`);
  }
  if (expected.confirmations !== undefined && row.confirmations !== expected.confirmations) {
    bad.push(`confirmations ${row.confirmations} ≠ ${expected.confirmations}`);
  }
  if (expected.supersedes !== undefined && (row.supersedesId !== null) !== expected.supersedes) {
    bad.push(
      `supersedes_id ${row.supersedesId === null ? 'null' : 'set'}, expected ${expected.supersedes ? 'set' : 'null'}`,
    );
  }
  return bad;
}

/** Evaluates `persisted.facts` and `persisted.factsAbsent` against the step's `user_facts` rows. */
export function evaluateFactExpectations(
  rows: FactRowSnapshot[],
  facts: FactRowExpect[] | undefined,
  factsAbsent: string[] | undefined,
  t0: Date,
): PersistedCheck[] {
  const out: PersistedCheck[] = [];
  for (const expected of facts ?? []) {
    const label = `persisted.facts:"${expected.fact}"${expected.status ? `[${expected.status}]` : ''}`;
    const named = rows.filter(r => r.fact.includes(expected.fact));
    const matched = expected.status ? named.filter(r => r.status === expected.status) : named;
    const wantCount = expected.count ?? 1;
    if (matched.length !== wantCount) {
      out.push({
        check: `${label}.count`,
        passed: false,
        detail: `expected ${wantCount}, found ${matched.length} (${describeRows(named)})`,
      });
      continue;
    }
    const bad = matched.flatMap(row => rowMismatches(row, expected, t0));
    out.push({ check: label, passed: bad.length === 0, ...(bad.length > 0 ? { detail: bad.join('; ') } : {}) });
  }
  for (const text of factsAbsent ?? []) {
    const named = rows.filter(r => r.fact.includes(text));
    out.push({
      check: `persisted.factsAbsent:"${text}"`,
      passed: named.length === 0,
      ...(named.length > 0 ? { detail: `still stored: ${describeRows(named)}` } : {}),
    });
  }
  return out;
}

/** Evaluates `persisted.plans`: exactly that many plan rows, each matching in order (newest first). */
export function evaluatePlanExpectations(
  plans: PlanRowSnapshot[],
  expected: PlanRowExpect[] | undefined,
): PersistedCheck[] {
  if (expected === undefined) {
    return [];
  }
  if (plans.length !== expected.length) {
    return [
      { check: 'persisted.plans.count', passed: false, detail: `expected ${expected.length}, found ${plans.length}` },
    ];
  }
  return expected.map((want, i) => {
    const plan = plans[i]!;
    const bad: string[] = [];
    if (want.status !== undefined && plan.status !== want.status) {
      bad.push(`status ${plan.status} ≠ ${want.status}`);
    }
    for (const name of want.exercises ?? []) {
      if (!plan.exerciseNames.includes(name)) {
        bad.push(`plan_json lacks "${name}" (has ${plan.exerciseNames.join(', ') || 'no exercises'})`);
      }
    }
    return {
      check: `persisted.plans[${i}]`,
      passed: bad.length === 0,
      ...(bad.length > 0 ? { detail: bad.join('; ') } : {}),
    };
  });
}
