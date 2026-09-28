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

// --- the L3 transcript formatter (smoke-test plan, Task 2 / AC-SM-2) ---
//
// One formatter for EVERY L3 run (not only the smoke): per step the user
// text, the coach's delivered reply, the tools the run called, the phase
// after, then that step's check lines ✓/✗ with the existing failure detail,
// closed by `passed X / failed Y / known-bug Z`. run.ts prints it to stdout
// and writes the same content to evals/reports/<scenario>-<ISO>.md. Pure
// formatting — no model, no DB, no I/O; unit-tested on fabricated input.

/**
 * The step data the transcript needs, mirrored locally (structural subset of
 * `ScenarioStepObservation` from run-scenario.ts and the schema's steps) so
 * the pure formatter imports no infra module — l3.ts passes the real shapes in.
 */
export interface ScenarioTranscript {
  scenarioId: string;
  /** The scenario's authored steps, parallel to `observations` by index. */
  steps: ReadonlyArray<{ action: 'advance' | 'user'; text?: string }>;
  /** What the run observed per step, parallel to `steps` by index. */
  observations: ReadonlyArray<{
    action: 'advance' | 'user';
    delivered: string;
    runRow: { toolCalls: ReadonlyArray<{ name: string }> | null } | null;
    phase: string;
  }>;
  checks: CheckResult[];
}

/** `passed/failed/known` with known-bug reproductions kept out of both counts. */
export interface TranscriptSummary {
  passed: number;
  failed: number;
  known: number;
}

export function summarizeChecks(checks: CheckResult[]): TranscriptSummary {
  let passed = 0;
  let failed = 0;
  let known = 0;
  for (const check of checks) {
    if (check.knownBug !== undefined) {
      known += 1;
    } else if (check.passed) {
      passed += 1;
    } else {
      failed += 1;
    }
  }
  return { passed, failed, known };
}

/** evaluateStep's case ids end in `::step <index>` — the formatter groups on that suffix. */
const CHECK_STEP_SUFFIX = /::step (\d+)$/;

function formatCheckLine(check: CheckResult): string {
  const mark = check.passed ? '✓' : '✗';
  const detail = !check.passed && check.detail !== undefined ? ` — ${check.detail}` : '';
  const knownBug = check.knownBug !== undefined ? ` [known bug ${check.knownBug}]` : '';
  return `  ${mark} ${check.check}${detail}${knownBug}`;
}

/** Multi-line delivered text stays readable: continuation lines align under the first. */
function withContinuation(label: string, text: string): string {
  const [first, ...rest] = text.split('\n');
  const pad = ' '.repeat(label.length);
  return [`${label}${first}`, ...rest.map(line => `${pad}${line}`)].join('\n');
}

export function formatScenarioTranscript(transcript: ScenarioTranscript): string {
  const checksByStep = new Map<number, CheckResult[]>();
  const unassigned: CheckResult[] = [];
  for (const check of transcript.checks) {
    const match = CHECK_STEP_SUFFIX.exec(check.case);
    if (match === null) {
      unassigned.push(check);
      continue;
    }
    const stepIndex = Number(match[1]);
    const bucket = checksByStep.get(stepIndex) ?? [];
    bucket.push(check);
    checksByStep.set(stepIndex, bucket);
  }

  const lines: string[] = [`## ${transcript.scenarioId}`, ''];
  transcript.steps.forEach((step, stepIndex) => {
    const obs = transcript.observations[stepIndex];
    if (step.action === 'advance') {
      lines.push(`#${stepIndex} (advance)`);
    } else {
      lines.push(`#${stepIndex} user: ${step.text ?? ''}`);
      if (obs !== undefined) {
        lines.push(withContinuation('coach: ', obs.delivered !== '' ? obs.delivered : '(no delivered text)'));
        const tools = obs.runRow?.toolCalls?.map(c => c.name) ?? [];
        lines.push(`tools: ${tools.length > 0 ? tools.join(', ') : '(none)'}`);
      }
    }
    if (obs !== undefined) {
      lines.push(`phase: ${obs.phase}`);
    }
    for (const check of checksByStep.get(stepIndex) ?? []) {
      lines.push(formatCheckLine(check));
    }
    lines.push('');
  });
  if (unassigned.length > 0) {
    lines.push('checks without a step:', ...unassigned.map(formatCheckLine), '');
  }
  const summary = summarizeChecks(transcript.checks);
  lines.push(`passed ${summary.passed} / failed ${summary.failed} / known-bug ${summary.known}`);
  return lines.join('\n');
}
