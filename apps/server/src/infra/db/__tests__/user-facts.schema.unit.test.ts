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

  // fact-lifecycle plan Task 1 (AC-FL-1): the lifecycle columns.
  it('exposes every lifecycle column', () => {
    const columns = Object.keys(userFacts);
    expect(columns).toEqual(
      expect.arrayContaining([
        'durability',
        'expiresAt',
        'reviewAfter',
        'phaseNote',
        'phaseAt',
        'onExpiry',
        'status',
        'archivedAt',
        'archivedReason',
        'closedByUserAt',
        'supersedesId',
        'context',
      ]),
    );
  });

  it('defaults durability to permanent and status to active — existing rows migrate unchanged', () => {
    expect(userFacts.durability.notNull).toBe(true);
    expect(userFacts.durability.default).toBe('permanent');
    expect(userFacts.status.notNull).toBe(true);
    expect(userFacts.status.default).toBe('active');
  });

  it('keeps every lifecycle date and closure column nullable — no dates on existing rows', () => {
    for (const column of [
      userFacts.expiresAt,
      userFacts.reviewAfter,
      userFacts.phaseAt,
      userFacts.archivedAt,
      userFacts.closedByUserAt,
    ]) {
      expect(column.notNull).toBe(false);
    }
  });

  it('keeps phaseNote, onExpiry, archivedReason, supersedesId and context nullable (set only when known)', () => {
    for (const column of [
      userFacts.phaseNote,
      userFacts.onExpiry,
      userFacts.archivedReason,
      userFacts.supersedesId,
      userFacts.context,
    ]) {
      expect(column.notNull).toBe(false);
    }
  });
});
