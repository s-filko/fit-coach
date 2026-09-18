import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildSearchKey } from '@infra/ai/graph/tool-policy';

import { CostRecorder, type CostRecord } from '../lib/cost-ledger';
import type { CheckResult } from '../lib/reporter';
import { type CaseObservation, type ModelInputMessage, runCase } from '../lib/run-case';
import { selectDatasetFiles } from '../lib/run-guard';
import { seededSearchKeys } from '../lib/seeded-search-keys';
import { type EvalCase, parseCases } from '../schema/case.schema';

/**
 * Resolved from process.cwd() rather than import.meta.dirname: this module is loaded
 * both by tsx (ESM, where import.meta exists) and by ts-jest (CommonJS, where it does
 * not compile). Every verification command in this repo runs from apps/server/, and
 * jest.config.cjs sets the same rootDir, so cwd is apps/server in both cases.
 */
const DATASETS_DIR = join(process.cwd(), 'evals', 'datasets');

/**
 * Datasets use PCRE-style inline flags (`(?i)…`) for case-insensitive patterns.
 * Node's RegExp rejects `(?i)` with a SyntaxError, so translate the prefix into
 * the equivalent `i` flag before compiling (controller-ruled amendment, 2026-09-13).
 */
function compilePattern(pattern: string): RegExp {
  return pattern.startsWith('(?i)') ? new RegExp(pattern.slice(4), 'i') : new RegExp(pattern);
}

function cyrillicRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) {
    return 0;
  }
  const cyrillic = letters.filter(ch => /[Ѐ-ӿ]/.test(ch)).length;
  return cyrillic / letters.length;
}

export function assertCase(testCase: EvalCase, observation: CaseObservation): CheckResult[] {
  const results: CheckResult[] = [];
  const add = (check: string, passed: boolean, detail?: string): void => {
    results.push({ case: testCase.id, check, passed, detail });
  };

  if (observation.threw) {
    add('runs-without-throwing', false, observation.threw);
    return results;
  }
  add('runs-without-throwing', true);

  // ADR-0013 §3.4 reporting half, §4.2 "Collect … budgetReport": every agent-backed
  // run must have attached its context budget report (positive estimated total).
  add(
    'budget-report-present',
    observation.budgetReport !== null && observation.budgetReport.total > 0,
    observation.budgetReport ? `total ${observation.budgetReport.total}` : 'no budget report attached',
  );

  // D-C / INV-LLM-004 (P4 context-budget plan Task 3/4): history never exceeds
  // its budget, and total never exceeds sum - outputReserve. Only emitted
  // when the report carries a `budget` (Task 3 shape) — earlier baselines
  // recorded reports without one.
  const { budgetReport } = observation;
  const { budget } = budgetReport ?? {};
  if (budget) {
    const sumMinusReserve = budget.system + budget.longTerm + budget.domain + budget.history - budget.outputReserve;
    const withinHistory = budgetReport!.history <= budget.history;
    const withinTotal = budgetReport!.total <= sumMinusReserve;
    let detail: string | undefined;
    if (!withinHistory) {
      detail = `history ${budgetReport!.history} > budget.history ${budget.history}`;
    } else if (!withinTotal) {
      detail = `total ${budgetReport!.total} > sum-outputReserve ${sumMinusReserve}`;
    }
    add('budget-within-limits', withinHistory && withinTotal, detail);
  }

  // D-C (P4 context-budget plan Task 4): every ToolMessage the model actually
  // received must answer a tool_call_id some AIMessage in the SAME input
  // carries — an orphan would reach the provider and could error or silently
  // confuse the model. Only emitted when a model call was observed.
  if (observation.lastModelInput.length > 0) {
    const carriedToolCallIds = new Set(observation.lastModelInput.flatMap(m => m.toolCallIds));
    const isOrphan = (m: ModelInputMessage): boolean =>
      m.toolCallId !== undefined && !carriedToolCallIds.has(m.toolCallId);
    const orphan = observation.lastModelInput.find(isOrphan);
    add(
      'no-orphan-tool-message',
      orphan === undefined,
      orphan ? `orphan tool_call_id ${orphan.toolCallId}` : undefined,
    );
  }

  const called = observation.toolCalls.map(tc => tc.name);

  for (const tool of testCase.expect.tools?.must ?? []) {
    add(`tools.must:${tool}`, called.includes(tool), called.length ? `called: ${called.join(', ')}` : 'no tool calls');
  }
  for (const tool of testCase.expect.tools?.mustNot ?? []) {
    add(`tools.mustNot:${tool}`, !called.includes(tool), called.includes(tool) ? `${tool} was called` : undefined);
  }
  for (const [tool, expectedArgs] of Object.entries(testCase.expect.tools?.args ?? {})) {
    const call = observation.toolCalls.find(tc => tc.name === tool);
    const matches =
      call !== undefined &&
      Object.entries(expectedArgs as Record<string, unknown>).every(([k, v]) => call.args[k] === v);
    add(`tools.args:${tool}`, matches, call ? `got ${JSON.stringify(call.args)}` : `${tool} not called`);
  }

  // D-N (AC-1344): emitted only for cases that seed at least one search.
  // Fails when the run re-issues a seeded search key or repeats one of its own.
  const seededKeys = seededSearchKeys(testCase);
  if (seededKeys.size > 0) {
    const seenThisRun = new Set<string>();
    let redundant: string | null = null;
    for (const call of observation.toolCalls) {
      if (call.name !== 'search_exercises') {
        continue;
      }
      const key = buildSearchKey(call.args);
      if (seededKeys.has(key) || seenThisRun.has(key)) {
        redundant = key;
        break;
      }
      seenThisRun.add(key);
    }
    add('no_redundant_search', redundant === null, redundant ? `repeated search key ${redundant}` : undefined);
  }

  if (testCase.expect.transition !== undefined) {
    add(
      'transition',
      observation.transition === testCase.expect.transition,
      `expected ${String(testCase.expect.transition)}, got ${String(observation.transition)}`,
    );
  }

  const { text } = testCase.expect;
  if (text) {
    for (const pattern of text.mustMatch ?? []) {
      add(`text.mustMatch:${pattern}`, compilePattern(pattern).test(observation.text));
    }
    for (const pattern of text.mustNotMatch ?? []) {
      const hit = compilePattern(pattern).test(observation.text);
      add(`text.mustNotMatch:${pattern}`, !hit, hit ? observation.text.slice(0, 120) : undefined);
    }
    if (text.language === 'ru') {
      const ratio = cyrillicRatio(observation.text);
      add('text.language', ratio >= 0.5, `cyrillic ratio ${ratio.toFixed(2)}`);
    }
    if (text.format === 'telegram_html') {
      const bad = /\*\*|(?<!\w)_[^_]+_(?!\w)|^#{1,6}\s/m.test(observation.text);
      add('text.format', !bad, bad ? 'markdown syntax in a Telegram HTML reply' : undefined);
    }
    if (text.maxChars !== undefined) {
      add('text.maxChars', observation.text.length <= text.maxChars, `${observation.text.length} chars`);
    }
    add('text.no-raw-uuid', !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(observation.text));
  }

  return results;
}

/** Loads a phase's cases; `dataset` (a file stem) narrows to `<dataset>.jsonl` (D-P). */
export function loadCases(phase: string, dataset?: string): EvalCase[] {
  const phases = phase === 'all' ? readdirSync(DATASETS_DIR) : [phase];
  const cases: EvalCase[] = [];
  for (const p of phases) {
    let files: string[];
    try {
      files = selectDatasetFiles(readdirSync(join(DATASETS_DIR, p)), dataset);
    } catch {
      continue;
    }
    for (const file of files) {
      cases.push(...parseCases(readFileSync(join(DATASETS_DIR, p, file), 'utf8')));
    }
  }
  return cases.filter(c => !c.deprecated);
}

/**
 * A case passes if at least ceil(n/2) samples pass (§4.2). `onCost` receives
 * each case's metered totals (D-Q) — the runner prints and ledgers them.
 */
export async function runL1(
  phase: string,
  samples: number,
  dataset?: string,
  onCost?: (caseId: string, record: CostRecord) => void,
): Promise<CheckResult[]> {
  const cases = loadCases(phase, dataset);
  const results: CheckResult[] = [];

  for (const testCase of cases) {
    const perSample: CheckResult[][] = [];
    const cost = new CostRecorder();
    for (let i = 0; i < samples; i += 1) {
      perSample.push(assertCase(testCase, await runCase(testCase, [cost])));
    }
    onCost?.(testCase.id, cost.record());

    const checkNames = [...new Set(perSample.flat().map(r => r.check))];
    for (const check of checkNames) {
      const passes = perSample.filter(sample => sample.find(r => r.check === check)?.passed).length;
      const threshold = Math.ceil(samples / 2);
      results.push({
        case: testCase.id,
        check,
        passed: passes >= threshold,
        detail: `${passes}/${samples} samples passed`,
      });
    }
  }

  return results;
}
