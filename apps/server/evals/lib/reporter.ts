export interface CheckResult {
  case: string;
  check: string;
  passed: boolean;
  detail?: string;
  /**
   * Known-bug reproduction tag (scenario schema's `knownBug`, L3): the
   * assertion is reported but never counted as a regression — the bug is
   * already recorded elsewhere and a fix is planned against its tag.
   */
  knownBug?: string;
}

export interface LevelReport {
  level: string;
  total: number;
  passed: number;
  failed: number;
  /** How many results are known-bug reproductions (L3) — excluded from `failed`. */
  known: number;
  results: CheckResult[];
}

export function buildReport(level: string, results: CheckResult[]): LevelReport {
  const passed = results.filter(r => r.passed).length;
  const known = results.filter(r => r.knownBug !== undefined).length;
  const failed = results.filter(r => !r.passed && r.knownBug === undefined).length;
  return { level, total: results.length, passed, failed, known, results };
}

export function printReport(report: LevelReport): void {
  for (const result of report.results) {
    if (!result.passed) {
      if (result.knownBug !== undefined) {
        console.log(`KNOWN  ${result.case} :: ${result.check} [known bug ${result.knownBug}]${result.detail ? ` — ${result.detail}` : ''}`);
      } else {
        console.error(`FAIL  ${result.case} :: ${result.check}${result.detail ? ` — ${result.detail}` : ''}`);
      }
    }
  }
  console.log(
    `\n${report.level}: ${report.passed}/${report.total} checks passed, ${report.failed} failed` +
      (report.known > 0 ? `, ${report.known} known bug(s) (not counted)` : ''),
  );
}

export function exitCodeFor(report: LevelReport): number {
  return report.failed > 0 ? 1 : 0;
}
