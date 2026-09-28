/**
 * UserFactsRepository unit tests (fact-lifecycle close-out, blocking finding 1):
 * the select-then-branch write in `rememberFact` is not atomic — the partial
 * unique index is the only guard. When a concurrent writer wins the INSERT,
 * the loser's insert raises Postgres 23505; the repository must catch it,
 * re-read and fall through to the UPDATE path so the caller still gets a
 * normal outcome (a raw DB error must never reach the model).
 */
import { UserFactsRepository } from '../user-facts.repository';

// The raced row: another writer inserted the same (userId, category, factKey)
// between our SELECT and our INSERT.
const RACED_ROW = {
  id: 'raced-1',
  userId: 'u1',
  category: 'equipment',
  fact: 'Has a barbell',
  factKey: 'has a barbell',
  muscleGroup: null,
  confirmations: 1,
  sourceTurnId: null,
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
  createdAt: new Date('2026-09-21T12:00:00Z'),
  updatedAt: new Date('2026-09-21T12:00:00Z'),
};

jest.mock('@infra/db/drizzle', () => ({
  db: { select: jest.fn(), insert: jest.fn(), update: jest.fn(), delete: jest.fn() },
}));
// Column stand-ins: the repository only embeds them in query builders we stub
// below — nothing ever executes, so opaque refs are enough.
jest.mock('@infra/db/schema', () => ({
  userFacts: new Proxy({}, { get: (_target, prop) => ({ __column: String(prop) }) }),
}));

/** A chain-shaped builder stub: every method returns an awaitable with `returning`. */
function chain(final: unknown) {
  const c: Record<string, unknown> = {};
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    final instanceof Error ? Promise.reject(final).then(resolve, reject) : Promise.resolve(final).then(resolve, reject);
  const self = new Proxy(c, {
    get(target, prop: string) {
      if (prop in target) {
        return target[prop];
      }
      return () => self;
    },
  });
  return self;
}

// Hoisted back out of the mock factory (jest.mock factories run before consts).
const mockDb = jest.requireMock('@infra/db/drizzle').db as {
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

const NOW = new Date('2026-09-21T12:00:00Z');

describe('UserFactsRepository — concurrent-write recovery (close-out finding 1)', () => {
  it('a 23505 on the INSERT re-reads and falls through to the UPDATE path — normal outcome, no raw error', async () => {
    const repository = new UserFactsRepository();
    const uniqueViolation = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    });

    // Call sequence: initial key SELECT (empty — the race window), INSERT
    // (loses to the concurrent writer), re-read SELECT (the raced row), UPDATE.
    mockDb.select
      .mockReturnValueOnce(chain([])) // initial lookup: nothing there
      .mockReturnValueOnce(chain([RACED_ROW])); // re-read: the winner's row
    mockDb.insert.mockReturnValueOnce(
      chain(uniqueViolation), // the loser's insert
    );
    mockDb.update.mockReturnValueOnce(
      chain([{ ...RACED_ROW, fact: 'Has a barbell', confirmations: 2, updatedAt: NOW }]),
    );

    const result = await repository.rememberFact(
      'u1',
      { category: 'equipment', fact: 'Has a barbell', durability: 'permanent', explicitPermanent: true },
      NOW,
    );

    expect(result).toMatchObject({ outcome: 'updated', fact: { id: 'raced-1', confirmations: 2 } });
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it('a non-unique error on the INSERT still propagates (no swallowing of real failures)', async () => {
    const repository = new UserFactsRepository();
    mockDb.select.mockReturnValueOnce(chain([]));
    mockDb.insert.mockReturnValueOnce(chain(new Error('db down')));

    await expect(
      repository.rememberFact(
        'u1',
        { category: 'equipment', fact: 'Has a barbell', durability: 'permanent', explicitPermanent: true },
        NOW,
      ),
    ).rejects.toThrow('db down');
  });
});
