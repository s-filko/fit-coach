/**
 * Unit tests for the scenario runner's hard DB guard (plan Task 2, Global
 * Constraints "Test-DB safety" 2026-09-20): the runner seeds and mutates real
 * rows through the production wiring, so it must refuse to start unless the
 * database name it would talk to ends in `_test`. Pure — no DB is opened.
 */
import { assertScenarioTestDatabase, isScenarioTestDatabase } from '../scenario-db-guard';

describe('scenario DB guard', () => {
  describe('isScenarioTestDatabase', () => {
    it.each([
      ['fitcoach_test', true],
      ['something_test', true],
      ['fitcoach_dev', false],
      ['fitcoach_prod', false],
      ['test', false], // the suffix is `_test`, not `test`
      ['fitcoach_test_copy', false], // suffix must be at the end
      ['', false],
      [undefined, false],
    ])('%j -> %s', (name, expected) => {
      expect(isScenarioTestDatabase(name)).toBe(expected);
    });
  });

  describe('assertScenarioTestDatabase', () => {
    it('passes silently for a _test database', () => {
      expect(() => assertScenarioTestDatabase('fitcoach_test')).not.toThrow();
    });

    it('throws naming the offending database for a non-test one', () => {
      expect(() => assertScenarioTestDatabase('fitcoach_dev')).toThrow(/fitcoach_dev/);
    });

    it('throws on an unset DB_NAME', () => {
      expect(() => assertScenarioTestDatabase(undefined)).toThrow(/DB_NAME/);
    });
  });
});
