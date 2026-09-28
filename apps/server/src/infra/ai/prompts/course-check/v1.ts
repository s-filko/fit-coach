import type { ConversationPhase } from '@domain/conversation/phases';
import type { UserFact } from '@domain/user/ports';
import { isReviewDue } from '@domain/user/services/fact-lifecycle';

import type { PromptModule, Section } from '@infra/ai/prompts/types';

const DAY_MS = 86_400_000;

export interface CourseCheckPromptContext {
  /** The run's effective phase. */
  phase: ConversationPhase;
  /** user.fitnessGoal — the stated goal; null when not stated yet. */
  goal: string | null;
  /** getForPrompt output at the run clock — active, not expired. */
  facts: UserFact[];
  /** The run clock (ctx.now) — decides the REVIEW DUE marks via isReviewDue. */
  now: Date;
  /** The active plan's id, or null. */
  activePlanId: string | null;
  /**
   * Expired `ask_once` facts due their ONE check-in question (expiryAction
   * 'ask'). They are listed apart from `facts`: they are no longer in force,
   * only owed a question — asked now, then archived by the step. Absent = none.
   */
  expiredAsk?: UserFact[];
}

/** One fact as the check must see it: the lifecycle view, with the due marks computed by fact-lifecycle. */
function factLine(fact: UserFact, now: Date): string {
  const bits = [
    fact.category,
    fact.durability,
    `${fact.confirmations}× confirmed`,
    `updated ${fact.updatedAt.toISOString().slice(0, 10)}`,
  ];
  if (fact.muscleGroup !== null) {
    bits.push(fact.muscleGroup);
  }
  if (fact.durability === 'long_term' && fact.phaseNote) {
    bits.push(`phase: ${fact.phaseNote}`);
  }
  if (fact.durability === 'short' && fact.expiresAt !== null) {
    const days = Math.ceil((fact.expiresAt.getTime() - now.getTime()) / DAY_MS);
    bits.push(`expires in ${Math.max(days, 0)} day(s)${fact.onExpiry === 'ask_once' ? ', ask_once' : ''}`);
  }
  const due = isReviewDue(fact, now) ? ' [REVIEW DUE — ask about it now]' : '';
  return `- ${fact.fact} (${bits.join(', ')})${due}`;
}

/** One expired ask_once fact: what it was, and how long ago its TTL ran out. */
function expiredLine(fact: UserFact, now: Date): string {
  const days = Math.max(Math.floor((now.getTime() - (fact.expiresAt ?? now).getTime()) / DAY_MS), 0);
  return `- ${fact.fact} (${fact.category}, expired ${days} day(s) ago) [EXPIRED — ask once now]`;
}

/**
 * Course-check prompt v1 (course-check plan Task 1, AC-FL-5): the input of the
 * one structured call that keeps the coach on course. Given the run's state —
 * phase, goal, active plan, the fact list with its lifecycle view — it returns
 * the typed directive (vector, constraints, questions, suspect facts,
 * exercise verdicts). The decision is made here, once per event; ordinary
 * turns carry the stored directive and never see this prompt.
 *
 * Pure (BR-LLM-007): no I/O, no clock reads — `now` arrives as data, and the
 * due/expiry marks reuse fact-lifecycle's predicates, never restate a rule.
 */
export const COURSE_CHECK_V1: PromptModule<CourseCheckPromptContext> = {
  id: 'course-check',
  version: 'v1',
  directives: [],
  render({ phase, goal, facts, now, activePlanId, expiredAsk = [] }): Section[] {
    const factList = facts.length > 0 ? facts.map(f => factLine(f, now)).join('\n') : 'no facts yet.';

    const expiredBlock =
      expiredAsk.length > 0
        ? `\n- expired facts owed ONE question (no longer in force; they are archived once you have asked):\n${expiredAsk
            .map(f => expiredLine(f, now))
            .join('\n')}`
        : '';

    return [
      {
        id: 'system',
        required: true,
        text: `You are the course-check layer of a fitness-coaching chat. Once, at a key moment, you look at where the user stands and return the directive the coach will follow until the next check.
Return ONLY the structured output with these six fields:
- vector: the user's current course — their stated goal in one line (an empty string is invalid; if no goal is stated, describe the course the facts imply, e.g. "General fitness, no fixed plan yet").
- constraints: the constraints in force right now, one short English sentence each (injuries, equipment, schedule).
- questions: what the coach should ask now — a REVIEW DUE fact gets ONE specific question about it; a still-active ask_once fact is NOT asked about yet (its one question comes after it expires); otherwise include the standing "how do you feel today" only when some fact makes it load-bearing. No questions when nothing is due.
- expiryQuestions: for each [EXPIRED — ask once now] fact, exactly ONE short check-in about whether the state left a trace — put it HERE, never in questions (it is shown in this one reply only and never stored, because the fact is archived right after). Empty when no fact is marked.
- suspectFacts: facts that look stale — contradicted by newer facts, or aged past plausibility — named with why. Empty when nothing looks stale.
- exerciseVerdicts: verdicts on exercises named in the input, each { exercise, verdict }. Usually empty — the check runs before anything is proposed.

Facts only, no style, no filler. Write in English regardless of the conversation language. An empty array is the correct, expected answer for the list fields most of the time — do not invent entries to avoid emptiness.`,
      },
      {
        id: 'user',
        required: true,
        text: `CURRENT STATE (date ${now.toISOString().slice(0, 10)}):
- phase: ${phase}
- stated goal: ${goal ?? 'not stated yet'}
- active plan: ${activePlanId ?? 'none'}
- facts:
${factList}${expiredBlock}
Course-check directive:`,
      },
    ];
  },
};
