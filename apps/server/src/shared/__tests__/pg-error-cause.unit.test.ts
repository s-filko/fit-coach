import { findInErrorCauseChain, isDatabaseFailure } from '../pg-error-cause';

describe('isDatabaseFailure (extracted from log-set/update-last-set tools, review R2)', () => {
  it('matches a raw pg error by its five-character SQLSTATE code', () => {
    const pgErr = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    expect(isDatabaseFailure(pgErr)).toBe(true);
  });

  it('matches a SQLSTATE code buried in the cause chain (drizzle wraps the driver error)', () => {
    const pgErr = Object.assign(new Error('connection terminated'), { code: '57P01' });
    const drizzleErr = Object.assign(new Error('Failed query: insert into ...'), { cause: pgErr });
    expect(isDatabaseFailure(drizzleErr)).toBe(true);
  });

  it('does not match an error whose code is not a SQLSTATE (e.g. a short app error code)', () => {
    const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    expect(isDatabaseFailure(err)).toBe(false);
  });

  it('does not match a plain error without any code', () => {
    expect(isDatabaseFailure(new Error('Validation failed'))).toBe(false);
  });

  it('does not match SQLSTATE-shaped text in the message alone', () => {
    expect(isDatabaseFailure(new Error('23505'))).toBe(false);
  });
});

describe('findInErrorCauseChain', () => {
  it('returns the first level for which match is non-null', () => {
    const inner = Object.assign(new Error('inner'), { constraint: 'sets_exercise_fk' });
    const err = Object.assign(new Error('outer'), { cause: inner });
    const constraint = findInErrorCauseChain(err, level =>
      typeof level.constraint === 'string' ? level.constraint : null,
    );
    expect(constraint).toBe('sets_exercise_fk');
  });

  it('returns null when no level matches', () => {
    expect(findInErrorCauseChain(new Error('plain'), () => null)).toBeNull();
  });
});
