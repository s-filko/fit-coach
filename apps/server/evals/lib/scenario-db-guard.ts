/**
 * The scenario runner's hard DB guard (plan Task 2; Global Constraints
 * "Test-DB safety", added 2026-09-20 after the Task 1 incident): the runner
 * seeds and mutates real rows through the production wiring, so it refuses to
 * start unless the database it would talk to ends in `_test`. Pure — the
 * runner wires it to `process.env.DB_NAME`, the same variable the pg pool and
 * the checkpointer resolve, so the guard and the connection cannot disagree.
 */
export function isScenarioTestDatabase(dbName: string | undefined): boolean {
  return typeof dbName === 'string' && dbName.endsWith('_test');
}

export function assertScenarioTestDatabase(dbName: string | undefined): void {
  if (!isScenarioTestDatabase(dbName)) {
    throw new Error(
      `Scenario runner refused to start: DB_NAME '${dbName ?? '<unset>'} does not end in _test. ` +
        'The runner seeds and mutates real rows — point DB_NAME at a throwaway test database.',
    );
  }
}
