import { userFacts } from '@infra/db/schema';

describe('user_facts schema (ADR-0009 table shape, D-B, D-C)', () => {
  it('exposes every column the idempotent upsert needs', () => {
    const columns = Object.keys(userFacts);
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'userId',
        'category',
        'fact',
        'factKey',
        'muscleGroup',
        'confirmations',
        'sourceTurnId',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('requires userId, category, fact and factKey (D-B)', () => {
    expect(userFacts.userId.notNull).toBe(true);
    expect(userFacts.category.notNull).toBe(true);
    expect(userFacts.fact.notNull).toBe(true);
    expect(userFacts.factKey.notNull).toBe(true);
  });

  it('leaves muscleGroup and sourceTurnId nullable (D-B, OQ-6)', () => {
    expect(userFacts.muscleGroup.notNull).toBe(false);
    expect(userFacts.sourceTurnId.notNull).toBe(false);
  });

  it('defaults confirmations to 1 (D-C confirmation counter)', () => {
    expect(userFacts.confirmations.notNull).toBe(true);
    expect(userFacts.confirmations.default).toBe(1);
  });
});
