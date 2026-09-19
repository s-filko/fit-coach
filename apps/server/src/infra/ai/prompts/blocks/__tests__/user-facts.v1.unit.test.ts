import type { UserFact } from '@domain/user/ports';

import { renderBlock } from '../index';
import { USER_FACTS_V1 } from '../user-facts.v1';

function fact(overrides: Partial<UserFact> = {}): UserFact {
  return {
    id: 'f1',
    userId: 'u1',
    category: 'equipment',
    fact: 'Trains at home with dumbbells only',
    factKey: 'trains at home with dumbbells only',
    muscleGroup: null,
    confirmations: 1,
    sourceTurnId: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

describe('USER_FACTS_V1 (D-F, ADR-0013 §3.4 block 2)', () => {
  it('renders nothing — not an empty heading — for zero facts', () => {
    expect(renderBlock(USER_FACTS_V1, { facts: [] })).toBe('');
  });

  it('renders the heading and a grouped, dashed line per fact for many facts', () => {
    const facts: UserFact[] = [
      fact({ id: 'f1', category: 'equipment', fact: 'Home dumbbells only' }),
      fact({ id: 'f2', category: 'physical_constraint', fact: 'Bad shoulder', muscleGroup: 'shoulders_front' }),
    ];
    const text = renderBlock(USER_FACTS_V1, { facts });

    expect(text).toContain('## User Facts');
    expect(text).toContain('equipment:');
    expect(text).toContain('- Home dumbbells only');
    expect(text).toContain('physical_constraint:');
    expect(text).toContain('- Bad shoulder (shoulders_front)');
  });

  it('groups consecutive same-category facts under one heading, not repeated per fact', () => {
    const facts: UserFact[] = [
      fact({ id: 'f1', category: 'equipment', fact: 'Has a barbell' }),
      fact({ id: 'f2', category: 'equipment', fact: 'Has dumbbells' }),
    ];
    const text = renderBlock(USER_FACTS_V1, { facts });
    const occurrences = text.split('equipment:').length - 1;
    expect(occurrences).toBe(1);
  });

  it('appends the muscle group in parens only when set', () => {
    const withMuscle = renderBlock(USER_FACTS_V1, {
      facts: [fact({ muscleGroup: 'lower_back', fact: 'Herniated disc' })],
    });
    const withoutMuscle = renderBlock(USER_FACTS_V1, {
      facts: [fact({ muscleGroup: null, fact: 'Prefers evenings' })],
    });
    expect(withMuscle).toContain('- Herniated disc (lower_back)');
    expect(withoutMuscle).toContain('- Prefers evenings');
    expect(withoutMuscle).not.toContain('(');
  });

  it('is pure: same input twice renders byte-identically', () => {
    const facts = [fact()];
    expect(renderBlock(USER_FACTS_V1, { facts })).toBe(renderBlock(USER_FACTS_V1, { facts }));
  });
});
