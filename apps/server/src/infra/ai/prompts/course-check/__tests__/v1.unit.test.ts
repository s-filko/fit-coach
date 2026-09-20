/**
 * COURSE_CHECK_V1 (course-check plan Task 1, AC-FL-5): the input prompt of
 * the structured course-check call. It hands the model the run's state —
 * phase, goal, active plan, the fact list with its lifecycle view (dates,
 * phase notes, REVIEW DUE / expiry flags via the fact-lifecycle predicates,
 * never restated) — and asks for the typed directive. Pure (BR-LLM-007):
 * everything arrives as data, `now` included.
 */
import type { UserFact } from '@domain/user/ports';

import { COURSE_CHECK_V1 } from '../v1';

const NOW = new Date('2026-09-21T12:00:00Z');

function fact(overrides: Partial<UserFact> = {}): UserFact {
  return {
    id: 'f1',
    userId: 'u1',
    category: 'physical_constraint',
    fact: 'Left shoulder aches when pressing',
    factKey: 'left shoulder aches when pressing',
    muscleGroup: 'shoulders_front',
    confirmations: 2,
    sourceTurnId: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-10T00:00:00Z'),
    durability: 'long_term',
    expiresAt: null,
    reviewAfter: new Date('2026-09-20T00:00:00Z'), // due before NOW
    phaseNote: 'tweaked three weeks ago',
    phaseAt: new Date('2026-09-01T00:00:00Z'),
    onExpiry: null,
    status: 'active',
    archivedAt: null,
    archivedReason: null,
    closedByUserAt: null,
    supersedesId: null,
    context: null,
    ...overrides,
  };
}

describe('COURSE_CHECK_V1 (AC-FL-5: the structured call’s input)', () => {
  it('renders one system and one user section', () => {
    const sections = COURSE_CHECK_V1.render({
      phase: 'plan_creation',
      goal: 'Build muscle',
      facts: [fact()],
      now: NOW,
      activePlanId: 'plan-1',
    });

    expect(sections).toHaveLength(2);
    expect(sections.map(s => s.id)).toEqual(['system', 'user']);
    expect(sections.every(s => s.required)).toBe(true);
  });

  it('the system section names the five directive fields — vector, constraints, questions, suspects, verdicts', () => {
    const [system] = COURSE_CHECK_V1.render({
      phase: 'chat',
      goal: null,
      facts: [],
      now: NOW,
      activePlanId: null,
    });

    for (const field of ['vector', 'constraints', 'questions', 'suspectFacts', 'exerciseVerdicts']) {
      expect(system.text).toContain(field);
    }
  });

  it('the user section carries the run state: date, phase, goal, plan, facts with lifecycle metadata', () => {
    const [, user] = COURSE_CHECK_V1.render({
      phase: 'plan_creation',
      goal: 'Build muscle',
      facts: [fact()],
      now: NOW,
      activePlanId: 'plan-1',
    });

    expect(user.text).toContain('2026-09-21');
    expect(user.text).toContain('plan_creation');
    expect(user.text).toContain('Build muscle');
    expect(user.text).toContain('plan-1');
    expect(user.text).toContain('Left shoulder aches when pressing');
    expect(user.text).toContain('long_term');
    expect(user.text).toContain('tweaked three weeks ago');
  });

  it('a review date that has arrived is marked — via the lifecycle predicate, visible as a question cue', () => {
    const [, user] = COURSE_CHECK_V1.render({
      phase: 'chat',
      goal: null,
      facts: [fact()],
      now: NOW,
      activePlanId: null,
    });

    expect(user.text).toContain('REVIEW DUE');
  });

  it('a review date not yet due is not marked', () => {
    const [, user] = COURSE_CHECK_V1.render({
      phase: 'chat',
      goal: null,
      facts: [fact({ reviewAfter: new Date('2026-10-20T00:00:00Z') })],
      now: NOW,
      activePlanId: null,
    });

    expect(user.text).not.toContain('REVIEW DUE');
  });

  it('an ask_once short fact near expiry shows its countdown; a forget fact does not', () => {
    const { render } = COURSE_CHECK_V1;
    const askOnce = render({
      phase: 'chat',
      goal: null,
      facts: [
        fact({
          durability: 'short',
          reviewAfter: null,
          expiresAt: new Date('2026-09-23T12:00:00Z'),
          onExpiry: 'ask_once',
        }),
      ],
      now: NOW,
      activePlanId: null,
    });
    expect(askOnce[1].text).toContain('ask_once');
    expect(askOnce[1].text).toContain('2 day');

    const forget = render({
      phase: 'chat',
      goal: null,
      facts: [
        fact({
          durability: 'short',
          reviewAfter: null,
          expiresAt: new Date('2026-09-23T12:00:00Z'),
          onExpiry: 'forget',
        }),
      ],
      now: NOW,
      activePlanId: null,
    });
    expect(forget[1].text).not.toContain('ask_once');
  });

  it('no facts renders an explicit empty list, not silence', () => {
    const [, user] = COURSE_CHECK_V1.render({
      phase: 'chat',
      goal: null,
      facts: [],
      now: NOW,
      activePlanId: null,
    });

    expect(user.text).toMatch(/no facts yet|none yet/i);
  });

  describe('expired ask_once facts (expiry performed)', () => {
    const expired = fact({
      id: 'exp-1',
      category: 'physical_constraint',
      fact: 'Left shoulder tweaked while pressing',
      durability: 'short',
      reviewAfter: null,
      expiresAt: new Date('2026-09-19T12:00:00Z'),
      onExpiry: 'ask_once',
    });

    it('lists each one apart from the facts in force, marked for ONE question, with how long ago it expired', () => {
      const [, user] = COURSE_CHECK_V1.render({
        phase: 'chat',
        goal: null,
        facts: [],
        now: NOW,
        activePlanId: null,
        expiredAsk: [expired],
      });

      expect(user.text).toContain(
        'Left shoulder tweaked while pressing (physical_constraint, expired 2 day(s) ago) [EXPIRED — ask once now]',
      );
      expect(user.text.indexOf('no facts yet.')).toBeLessThan(user.text.indexOf('expired facts owed ONE question'));
    });

    it('renders nothing extra when none is due', () => {
      const [, user] = COURSE_CHECK_V1.render({ phase: 'chat', goal: null, facts: [], now: NOW, activePlanId: null });

      expect(user.text).not.toContain('expired facts owed');
      expect(user.text).not.toContain('day(s) ago');
    });

    it('the system text asks for exactly one check-in for it, and none for a still-active ask_once fact', () => {
      const [system] = COURSE_CHECK_V1.render({ phase: 'chat', goal: null, facts: [], now: NOW, activePlanId: null });

      expect(system.text).toContain('exactly ONE short check-in');
      expect(system.text).toMatch(/still-active ask_once fact is NOT asked about yet/);
    });
  });
});
