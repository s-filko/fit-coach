import { describeSchemaError, formatDatabaseTarget } from '../db-target';

const TARGET = { host: 'db', port: 5432, database: 'fitcoach_dev' };

describe('formatDatabaseTarget (AC-AT-5 — which database, printed unconditionally)', () => {
  it('names the host, port and database, so a reader never has to guess which one answered', () => {
    expect(formatDatabaseTarget(TARGET)).toBe('Reading from postgres://db:5432/fitcoach_dev');
  });

  it('distinguishes two otherwise-identical-looking targets', () => {
    const test = formatDatabaseTarget({ ...TARGET, database: 'fitcoach_test' });
    expect(formatDatabaseTarget(TARGET)).not.toBe(test);
  });
});

describe('describeSchemaError (AC-AT-5 — a friendly sentence when the schema is behind)', () => {
  it('returns a sentence naming the database for an undefined_column error (42703)', () => {
    const err = { code: '42703', message: 'column "error_class" does not exist' };
    const message = describeSchemaError(err, TARGET);

    expect(message).not.toBeNull();
    expect(message).toContain('db:5432/fitcoach_dev');
    expect(message).toContain('column "error_class" does not exist');
    expect(message).toContain('--env-file');
  });

  it('returns a sentence for an undefined_table error (42P01) too', () => {
    const err = { code: '42P01', message: 'relation "llm_calls" does not exist' };
    expect(describeSchemaError(err, TARGET)).toContain('relation "llm_calls" does not exist');
  });

  it('returns null for an unrelated error — the caller must print that one unchanged', () => {
    expect(describeSchemaError(new Error('connection refused'), TARGET)).toBeNull();
    expect(describeSchemaError({ code: '23505', message: 'duplicate key' }, TARGET)).toBeNull();
  });

  it('returns null for a non-error value without throwing', () => {
    expect(describeSchemaError(null, TARGET)).toBeNull();
    expect(describeSchemaError('a string', TARGET)).toBeNull();
  });

  it('still names the database even when the driver error has no message', () => {
    const message = describeSchemaError({ code: '42703' }, TARGET);
    expect(message).toContain('db:5432/fitcoach_dev');
    expect(message).toMatch(/missing column or table/);
  });

  it('unwraps a drizzle-orm DrizzleQueryError, whose real Postgres code lives on .cause — the shape actually thrown', () => {
    const cause = { code: '42703', message: 'column "error_class" does not exist' };
    const wrapped = Object.assign(new Error('Failed query: select ...'), { cause });
    const message = describeSchemaError(wrapped, TARGET);

    expect(message).not.toBeNull();
    expect(message).toContain('column "error_class" does not exist');
    expect(message).toContain('db:5432/fitcoach_dev');
  });

  it('returns null for a wrapped error whose cause is unrelated', () => {
    const wrapped = Object.assign(new Error('Failed query'), { cause: { code: '23505' } });
    expect(describeSchemaError(wrapped, TARGET)).toBeNull();
  });
});
