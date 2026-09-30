/**
 * `training.load_plan` v2 (load-plan plan D4, D6, O1; design §3.4): the v1 fact lines plus the scheme, the
 * tactic, the matching decision stage and row, a recommendation with its reason, the conservative option and the
 * confidence. The number is a SUGGESTION with its reason, not a binding value: the model decides the load from the
 * current situation and states its reason when it departs from the suggestion (Principle 6, O1).
 *
 * One producer, two consumers, as in v1: the block and `get_load_plan` both call `renderLoadPlanEntryV2`. The pure
 * decision comes from `@domain/training/load-plan`; selected only with `LOAD_PLAN_SUGGESTION` on (training.spec.ts).
 * v2 words (D6): equipment facts once per block, a negative drop-off as "none (reps rose)", the e1RM span printed.
 */
import { isAbsent } from '@domain/training/load-facts';
import {
  type Decision,
  type DecisionRow,
  defaultProgression,
  type ProgressionChoice,
  progressionFromChoice,
  type Recommendation,
} from '@domain/training/load-plan';

import { decideLoadPlanEntry, type LoadDecisionOpts } from '@infra/ai/load-facts/load-decision';
import type { LoadPlanEntry } from '@infra/ai/load-facts/load-facts.loader';

import { formatInUserTz } from '@shared/date-utils';

import { type ExerciseHistoryEntry } from './training-exercise-history.v1';
import { renderLoadPlanEntry, type RenderLoadPlanOpts, type TrainingLoadPlanData } from './training-load-plan.v1';
import type { ContextBlock, ContextBlockCtx } from './types';

export const LOAD_PLAN_HEADER_V2 =
  '=== LOAD PLAN (computed facts and a suggestion with its reason — you decide the load; state your reason if you depart from it) ===';

const INDENT = '  ';
const DEFAULT_UNIT = 'kg';

export interface RenderLoadPlanV2Opts extends RenderLoadPlanOpts, LoadDecisionOpts {
  /** A decision the caller already took with `decideLoadPlanEntry` (null = non-strength); absent = decide here. */
  decision?: Decision | null;
}

export interface TrainingLoadPlanV2Data extends TrainingLoadPlanData {
  /** Absent = the profile-less default (double progression). */
  progression?: ProgressionChoice;
}

function repsText(r: { min: number; max: number }): string {
  return r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
}

/** v2 wording of the decision rows — the domain returns the row id, the words live here (ADR-0013 D-09). */
const ROW_LABELS_V2: Record<DecisionRow, string> = {
  insufficient_data: 'insufficient data',
  short_constraint: 'short constraint',
  gap_return: 'gap tier return',
  gap_rebuild: 'gap tier rebuild',
  gap_restart: 'gap tier restart',
  pre_fatigue: 'pre-fatigue delta',
  below_floor: 'last below range floor',
  scheme_growth: 'scheme growth',
  scheme_hold: 'scheme hold',
};

/** The one spelling of a scheme's name in this block: `double progression`, `linear progression`. */
function schemeName(id: string): string {
  return id.replace(/_/g, ' ');
}

/** The one spelling of the choice's provenance: the day the user chose it, or `default, unconfirmed`. */
function provenanceText(choice: ProgressionChoice, timezone: string | null): string {
  return choice.source === 'user' && choice.chosenAt
    ? `chosen by user ${formatInUserTz(choice.chosenAt, timezone).dateOnly}`
    : 'default, unconfirmed';
}

/**
 * `Progression: double progression, confirm ×2 — chosen by user 2026-09-20` (design §4.2), or `— default, unconfirmed`.
 * No rep range: each exercise works on its own (today's range, else the scheme default — printed per entry), so one
 * block never shows two contradicting ranges.
 */
function progressionLine(choice: ProgressionChoice, timezone: string | null): string {
  const { confirmSessions } = choice.scheme.defaultParams(choice.goal);
  return `Progression: ${schemeName(choice.scheme.id)}, confirm ×${confirmSessions} — ${provenanceText(choice, timezone)}`;
}

function schemeLine(
  choice: ProgressionChoice,
  confirmSessions: number,
  repText: string,
  repsFromScheme: boolean,
  timezone: string | null,
): string {
  const reps = repsFromScheme ? `${repText} (scheme default)` : repText;
  return `scheme: ${schemeName(choice.scheme.id)} ${reps}, confirm ×${confirmSessions} (${provenanceText(choice, timezone)})`;
}

function loadText(rec: Recommendation, perHand: boolean): string | null {
  if (rec.load === null) {
    return null;
  }
  return `${rec.load} ${rec.unit ?? DEFAULT_UNIT}${perHand ? ' per hand' : ''} × ${repsText(rec.reps)}`;
}

function confidenceText(entry: LoadPlanEntry, d: Decision): string {
  const { facts } = entry;
  const parts: string[] = [];
  if (!isAbsent(facts.e1rmTrend) && facts.e1rmTrend.lowConfidence) {
    parts.push(facts.e1rmTrend.lowConfidence);
  }
  parts.push(`${facts.dataSufficiency.last56Days} performances / 8 wk`);
  if (d.gap.tier !== 'rest') {
    parts.push(`gap tier ${d.gap.tier}, general norm`);
  }
  if (d.missing.length > 0) {
    parts.push(`missing: ${d.missing.join(', ')}`);
  }
  return `confidence: ${d.confidence} (${parts.join('; ')})`;
}

/** Task 4: the tier and the ladder step, printed only with `LOAD_PLAN_BREAKS` on and a gap worth a line. */
function breakLine(entry: LoadPlanEntry, d: Decision): string[] {
  const branch = entry.returnBranch;
  if (!branch || (d.ladder === null && d.gap.tier === 'rest')) {
    return [];
  }
  const parts: string[] = [];
  if (d.ladder) {
    const step = d.ladder.coldStart ? 'cold start' : `return workout ${d.ladder.workout} of ${d.ladder.of}`;
    parts.push(`tier ${d.ladder.tier} (general norm)`, step);
  } else {
    parts.push(`tier ${d.gap.tier} (${d.gap.days} d since ${d.gap.basis}, general norm)`);
  }
  parts.push(`reason ${branch.breakReason}`);
  return [`break: ${parts.join(' · ')}`];
}

/** " — 2.5 kg lower", or " — no lighter option" when the floored step-down left the conservative load unchanged. */
function lowerNote(d: Decision, lower: number): string {
  if (lower > 0) {
    return ` — ${lower} ${d.conservative.unit ?? DEFAULT_UNIT} lower`;
  }
  return d.candidate.load !== null && d.candidate.load === d.conservative.load ? ' — no lighter option' : '';
}

function decisionLines(
  entry: LoadPlanEntry,
  d: Decision | null,
  opts: RenderLoadPlanV2Opts,
  timezone: string | null,
): string[] {
  const { facts, exercise } = entry;
  if (d === null) {
    return [`recommend: n/a for ${exercise.exerciseType}`];
  }
  const progression = progressionFromChoice(opts.progression, entry.chosenScheme);
  const params = progression.scheme.defaultParams(progression.goal);
  const perHand = !isAbsent(facts.equipmentStep) && facts.equipmentStep.perHand;
  const rec = loadText(d.candidate, perHand);
  const cons = loadText(d.conservative, perHand);
  const lower = d.candidate.load !== null && d.conservative.load !== null ? d.candidate.load - d.conservative.load : 0;
  return [
    schemeLine(
      progression,
      params.confirmSessions,
      repsText(d.candidate.reps),
      // The range is the scheme's own when no plan/reference range exists, or the scheme fixes the reps (linear).
      isAbsent(facts.repRange) || params.fixedReps !== undefined,
      timezone,
    ),
    `tactic: ${d.tactic}`,
    ...breakLine(entry, d),
    `decision: Stage ${d.stage}, ${ROW_LABELS_V2[d.row]} → ${d.outcome}`,
    `recommend: ${rec === null ? d.reason : `${rec} — ${d.reason}`}`,
    `conservative: ${cons === null ? d.reason : `${cons}${lowerNote(d, lower)}`}`,
    confidenceText(entry, d),
  ];
}

/** One exercise's entry: the v1 fact lines (v2 wording) plus the decision lines. */
export function renderLoadPlanEntryV2(entry: LoadPlanEntry, ctx: ContextBlockCtx, opts: RenderLoadPlanV2Opts): string {
  const facts = renderLoadPlanEntry(entry, ctx, { ...opts, dropOff: 'plain', e1rmSpan: true });
  const decision = opts.decision === undefined ? decideLoadPlanEntry(entry, opts) : opts.decision;
  return [facts, ...decisionLines(entry, decision, opts, ctx.timezone).map(l => `${INDENT}${l}`)].join('\n');
}

export const TRAINING_LOAD_PLAN_V2: ContextBlock<TrainingLoadPlanV2Data> = {
  id: 'training.load_plan',
  version: 'v2',
  render(data, ctx) {
    if (data.loadPlan.length === 0) {
      return null;
    }
    const historyRowOf = new Map(
      data.exerciseHistory.map((h: ExerciseHistoryEntry) => [h.exerciseId, h.performance?.id ?? null]),
    );
    const entries = data.loadPlan.map(e =>
      renderLoadPlanEntryV2(e, ctx, {
        progression: data.progression ?? defaultProgression(null),
        historyRowId: historyRowOf.get(e.exercise.id) ?? null,
        equipment: 'omit',
      }),
    );
    const { equipment } = data.loadPlan[0].facts.constraints;
    // Task 5a (design §4.2): one line for the scheme in force — the user's choice with its date, or the default.
    const progression = progressionFromChoice(
      data.progression ?? defaultProgression(null),
      data.loadPlan[0].chosenScheme,
    );
    const progressionText = `${progressionLine(progression, ctx.timezone)}\n\n`;
    const equipmentLine = equipment.length === 0 ? '' : `equipment facts (all exercises): ${equipment.join('; ')}\n\n`;
    return `${LOAD_PLAN_HEADER_V2}\n\n${progressionText}${equipmentLine}${entries.join('\n\n')}`;
  },
};
