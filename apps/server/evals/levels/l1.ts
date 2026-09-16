import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CheckResult } from '../lib/reporter';
import { type CaseObservation, runCase } from '../lib/run-case';
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

function loadCases(phase: string): EvalCase[] {
  const phases = phase === 'all' ? readdirSync(DATASETS_DIR) : [phase];
  const cases: EvalCase[] = [];
  for (const p of phases) {
    let files: string[];
    try {
      files = readdirSync(join(DATASETS_DIR, p)).filter(f => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      cases.push(...parseCases(readFileSync(join(DATASETS_DIR, p, file), 'utf8')));
    }
  }
  return cases.filter(c => !c.deprecated);
}

/** A case passes if at least ceil(n/2) samples pass (§4.2). */
export async function runL1(phase: string, samples: number): Promise<CheckResult[]> {
  const cases = loadCases(phase);
  const results: CheckResult[] = [];

  for (const testCase of cases) {
    const perSample: CheckResult[][] = [];
    for (let i = 0; i < samples; i += 1) {
      perSample.push(assertCase(testCase, await runCase(testCase)));
    }

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
