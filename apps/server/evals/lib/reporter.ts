export interface CheckResult {
  case: string;
  check: string;
  passed: boolean;
  detail?: string;
}

export interface LevelReport {
  level: string;
  total: number;
  passed: number;
  failed: number;
  results: CheckResult[];
}

export function buildReport(level: string, results: CheckResult[]): LevelReport {
  const passed = results.filter(r => r.passed).length;
  return { level, total: results.length, passed, failed: results.length - passed, results };
}

export function printReport(report: LevelReport): void {
  for (const result of report.results) {
    if (!result.passed) {
      console.error(`FAIL  ${result.case} :: ${result.check}${result.detail ? ` — ${result.detail}` : ''}`);
    }
  }
  console.log(`\n${report.level}: ${report.passed}/${report.total} checks passed, ${report.failed} failed`);
}

export function exitCodeFor(report: LevelReport): number {
  return report.failed > 0 ? 1 : 0;
}
