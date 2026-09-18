import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CheckResult } from './reporter';

export interface BaselineEntry {
  case: string;
  check: string;
  passed: boolean;
  detail?: string;
}

export interface Baseline {
  version: string;
  model: string;
  samples: number;
  recordedAt: string;
  /** Dataset stem when the baseline was written with --dataset (D-P); absent = full run. */
  dataset?: string;
  entries: BaselineEntry[];
}

export interface BaselineDiff {
  regressions: BaselineEntry[];
  improvements: BaselineEntry[];
  missing: string[];
  added: string[];
}

/**
 * Resolved from process.cwd() rather than import.meta.dirname: this module is loaded
 * both by tsx (ESM) and by ts-jest (CommonJS, where import.meta does not compile).
 * Every verification command in this repo runs from apps/server/ (same convention as
 * levels/l1.ts), so cwd is apps/server in both cases.
 */
function baselineDir(): string {
  return process.env['EVAL_BASELINE_DIR'] ?? join(process.cwd(), 'evals', 'baselines');
}

function baselinePath(version: string, phase: string): string {
  return join(baselineDir(), version, `${phase}.json`);
}

const key = (entry: { case: string; check: string }): string => `${entry.case}::${entry.check}`;

export function writeBaseline(
  version: string,
  phase: string,
  model: string,
  samples: number,
  results: CheckResult[],
  dataset?: string,
): string {
  const path = baselinePath(version, phase);
  mkdirSync(join(baselineDir(), version), { recursive: true });
  const baseline: Baseline = {
    version,
    model,
    samples,
    recordedAt: new Date().toISOString(),
    ...(dataset !== undefined ? { dataset } : {}),
    entries: results.map(r => ({ case: r.case, check: r.check, passed: r.passed, detail: r.detail })),
  };
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  return path;
}

export function readBaseline(version: string, phase: string): Baseline {
  const path = baselinePath(version, phase);
  if (!existsSync(path)) {
    throw new Error(`No baseline at ${path} — write one first with --baseline write`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Baseline;
}

export function compareToBaseline(
  version: string,
  phase: string,
  results: CheckResult[],
  dataset?: string,
): BaselineDiff {
  const baseline = readBaseline(version, phase);
  // D-P: a dataset-scoped baseline never compares against a full run and vice
  // versa — the numbers answer different questions.
  if ((baseline.dataset ?? '') !== (dataset ?? '')) {
    const scope = (d?: string): string => d ?? 'full run';
    throw new Error(
      `baseline scope mismatch: ${version}/${phase} was written for ${scope(baseline.dataset)}, this run is ${scope(dataset)} — re-run with a matching --dataset`,
    );
  }
  const before = new Map(baseline.entries.map(e => [key(e), e]));
  const after = new Map(results.map(r => [key(r), r]));

  const regressions: BaselineEntry[] = [];
  const improvements: BaselineEntry[] = [];
  const missing: string[] = [];

  for (const [k, entry] of before) {
    const now = after.get(k);
    if (!now) {
      missing.push(k);
      continue;
    }
    if (entry.passed && !now.passed) {
      regressions.push({ case: now.case, check: now.check, passed: false, detail: now.detail });
    }
    if (!entry.passed && now.passed) {
      improvements.push({ case: now.case, check: now.check, passed: true, detail: now.detail });
    }
  }

  const added = [...after.keys()].filter(k => !before.has(k));
  return { regressions, improvements, missing, added };
}
