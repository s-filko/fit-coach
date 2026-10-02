/**
 * `renderTrainingProfile` (coach-simplification I1, AC-CS1-1): the stable `# Profile` — one line per fact,
 * deduplicated; no confirmation counts, no dates, no category headings; the registration goal only without facts.
 */
import type { FactCategory, UserFact } from '@domain/user/ports';
import type { User } from '@domain/user/services/user.service';

import { renderTrainingProfile } from '../training-profile';

const USER: User = {
  id: 'u1',
  firstName: 'Alex',
  age: 34,
  gender: 'male',
  height: 180,
  weight: 80,
  fitnessLevel: 'intermediate',
  fitnessGoal: 'strength, 3 sessions a week',
};

let seq = 0;
function fact(category: FactCategory, text: string, over: Partial<UserFact> & { updated?: string } = {}): UserFact {
  seq += 1;
  const { updated, ...rest } = over;
  const at = new Date(updated ?? '2026-09-20T00:00:00.000Z');
  return {
    id: `f${seq}`,
    userId: 'u1',
    category,
    fact: text,
    factKey: `k${seq}`,
    muscleGroup: null,
    confirmations: 1,
    sourceTurnId: null,
    createdAt: at,
    updatedAt: at,
    durability: 'permanent',
    expiresAt: null,
    reviewAfter: null,
    phaseNote: null,
    phaseAt: null,
    onExpiry: null,
    status: 'active',
    archivedAt: null,
    archivedReason: null,
    closedByUserAt: null,
    supersedesId: null,
    context: null,
    evidence: null,
    ...rest,
  } as UserFact;
}

/** Eleven facts shaped like a real client's: three on the lower back, a break and a scheme to drop. */
const FACTS: UserFact[] = [
  fact('coaching_preference', 'Prefers machines and cables'),
  fact('physical_constraint', 'Lower back: dull heaviness, no acute pain', {
    muscleGroup: 'lower_back',
    updated: '2026-09-10T00:00:00.000Z',
  }),
  fact('physical_constraint', 'Lower back: avoid heavy axial loading', {
    muscleGroup: 'lower_back',
    updated: '2026-09-25T00:00:00.000Z',
    confirmations: 3,
  }),
  fact('physical_constraint', 'Lower back: stiff in the morning', {
    muscleGroup: 'lower_back',
    updated: '2026-09-18T00:00:00.000Z',
  }),
  fact('schedule_constraint', 'Trains about five times a week, no fixed days'),
  fact('exercise_preference', 'Short endurance holds for core', { muscleGroup: 'core' }),
  fact('equipment', 'Machine adds its own unknown weight', { muscleGroup: 'quads' }),
  fact('physiological_pattern', 'Reports effort as RPE himself'),
  fact('break', 'Pause after a trip, back on Sep 27'),
  fact('progression_scheme', 'double_progression'),
  fact('coaching_preference', 'Speaks Russian'),
];

describe('renderTrainingProfile', () => {
  it('starts with the user line, omitting unknown parts', () => {
    expect(
      renderTrainingProfile(USER, [fact('equipment', 'Home gym')])
        .split('\n')
        .slice(0, 2),
    ).toEqual(['# Profile', '- Alex, 34, male, 180 cm, 80 kg, intermediate']);
    expect(renderTrainingProfile({ id: 'u2', firstName: 'Sam', weight: 70 }, []).split('\n')[1]).toBe('- Sam, 70 kg');
  });

  it('collapses facts on one (category, muscleGroup) to the latest one; ties go to more confirmations', () => {
    const text = renderTrainingProfile(USER, FACTS);
    const lowerBack = text.split('\n').filter(l => l.includes('Lower back'));
    expect(lowerBack).toEqual(['- Lower back: avoid heavy axial loading']);

    const tie = [
      fact('physical_constraint', 'Knee: old wording', { muscleGroup: 'quads', confirmations: 1 }),
      fact('physical_constraint', 'Knee: confirmed wording', { muscleGroup: 'quads', confirmations: 4 }),
    ];
    expect(renderTrainingProfile(USER, tie)).toContain('- Knee: confirmed wording');
    expect(renderTrainingProfile(USER, tie)).not.toContain('old wording');
  });

  it('drops break and progression_scheme facts', () => {
    const text = renderTrainingProfile(USER, FACTS);
    expect(text).not.toContain('Pause after a trip');
    expect(text).not.toContain('double_progression');
  });

  it('puts physical constraints first, then keeps the incoming order', () => {
    const lines = renderTrainingProfile(USER, FACTS).split('\n').slice(2);
    expect(lines).toEqual([
      '- Lower back: avoid heavy axial loading',
      '- Prefers machines and cables',
      '- Trains about five times a week, no fixed days',
      '- Short endurance holds for core',
      '- Machine adds its own unknown weight',
      '- Reports effort as RPE himself',
      '- Speaks Russian',
    ]);
  });

  it('prints no confirmation counts, dates or category headings', () => {
    const text = renderTrainingProfile(USER, FACTS);
    expect(text).not.toMatch(/confirmed|×|\d{4}-\d{2}-\d{2}|updated|physical_constraint|coaching_preference/i);
  });

  it('adds the phase note of a long-term fact', () => {
    const f = fact('physical_constraint', 'Wrist injury', {
      durability: 'long_term',
      phaseNote: 'in a cast three weeks ago',
    });
    expect(renderTrainingProfile(USER, [f])).toContain('- Wrist injury (in a cast three weeks ago)');
  });

  it('shows the registration goal only when there are no facts', () => {
    expect(renderTrainingProfile(USER, [])).toContain('- Goal at registration: strength, 3 sessions a week');
    expect(renderTrainingProfile(USER, FACTS)).not.toContain('Goal at registration');
    expect(renderTrainingProfile(USER, FACTS)).not.toContain('3 sessions a week');
  });

  it('says so when nothing is known', () => {
    expect(renderTrainingProfile(null, [])).toBe('# Profile\n- No profile data yet.');
  });
});
