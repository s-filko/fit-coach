/**
 * Eval runner — see docs/PROMPT_EVAL_FRAMEWORK.md.
 * Usage: npm run evals -- --level L0|L1 [--phase chat|all] [--samples 3]
 *                    [--dataset <stem>] [--baseline write|compare] [--baseline-version v0]
 *                    [--quota-before <n>]
 *
 * Red button (§7a, D-P): every L1 run prints its planned model calls before
 * anything runs and refuses above EVALS_CALL_CEILING (default 30) unless
 * EVALS_FULL_RUN=1 is set (owner-launched).
 *
 * Metering (D-Q): every L1 run prints requests/tokens per case and in total,
 * and appends a row to evals/COST_LEDGER.md. Quota is read automatically when
 * readQuota() finds an endpoint (D-R: none confirmed as of 2026-09-18), else
 * via --quota-before <n> and completed with `npm run evals:ledger -- --after <n>`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EVAL_PHASES, runL0 } from './levels/l0';
import { loadCases, runL1 } from './levels/l1';
import {
  appendLedgerRow,
  completeLastRow,
  estimateRun,
  estimateWeeklyPct,
  parseLedgerTable,
  summarizeCost,
  type CostRecord,
} from './lib/cost-ledger';
import { readQuota } from './lib/quota';
import { guardDecision, planCallCount } from './lib/run-guard';
import { buildReport, type CheckResult, exitCodeFor, printReport } from './lib/reporter';

const LEDGER_PATH = join(process.cwd(), 'evals', 'COST_LEDGER.md');

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function ledgerText(): string {
  return existsSync(LEDGER_PATH) ? readFileSync(LEDGER_PATH, 'utf8') : '';
}

async function main(): Promise<void> {
  const level = argValue('--level', 'L0').toUpperCase();
  const phase = argValue('--phase', 'all');
  const samples = Number(argValue('--samples', '3'));
  const dataset = argValue('--dataset', '');

  if (dataset !== '' && phase === 'all') {
    console.error('--dataset requires --phase <phase> — a dataset lives in one phase directory');
    process.exit(2);
  }

  // Results per phase, so --baseline writes one file per phase even with --phase all
  // (a later single-phase compare needs a single-phase baseline file).
  const perPhaseResults = new Map<string, CheckResult[]>();

  if (level === 'L0') {
    // L0 iterates the prompt registry itself — runL0('all') covers phase modules
    // AND standalone modules (summarizer, blocks); a specific phase renders just
    // that phase's module.
    perPhaseResults.set(phase, await runL0(phase));
  } else {
    const phases = phase === 'all' ? EVAL_PHASES : [phase];
    if (level === 'L1') {
      if (process.env['RUN_LLM_EVALS'] !== '1') {
        console.log('L1 skipped: set RUN_LLM_EVALS=1 to run evals against a real model.');
        process.exit(0);
      }

      // D-P red button: count the calls before any model is reached.
      const casesPerPhase = phases.map(p => [p, loadCases(p, dataset || undefined)] as const);
      const caseCount = casesPerPhase.reduce((n, [, cases]) => n + cases.length, 0);
      const plannedCalls = planCallCount(caseCount, samples);
      const ceiling = Number(process.env['EVALS_CALL_CEILING'] ?? 30);
      const guard = guardDecision(plannedCalls, {
        ceiling,
        fullRun: process.env['EVALS_FULL_RUN'] === '1',
      });
      console.log(`planned model calls: ${plannedCalls} (${caseCount} cases × ${samples} samples, ceiling ${ceiling})`);
      if (guard.message) {
        console.log(guard.message);
      }
      if (!guard.ok) {
        process.exit(3);
      }

      // D-R/D-Q quota gate + pre-run estimate banner.
      const quota = readQuota();
      const quotaBeforeFlag = argValue('--quota-before', '');
      if (quota === null && quotaBeforeFlag === '') {
        console.error(
          'L1 requires --quota-before <n> (the Z.AI dashboard number): no quota endpoint is readable (D-R). ' +
            'Complete the ledger row afterwards with: npm run evals:ledger -- --after <n>',
        );
        process.exit(2);
      }
      const weeklyLimit = process.env['EVALS_WEEKLY_LIMIT'] ? Number(process.env['EVALS_WEEKLY_LIMIT']) : undefined;
      const ledger = parseLedgerTable(ledgerText());
      const estimate = estimateRun(plannedCalls, ledger);
      const estWeeklyPct = estimateWeeklyPct(plannedCalls, ledgerText(), weeklyLimit);
      console.log(
        `estimate: ~${estimate.estimatedTokens} tokens${estimate.note ? ` (${estimate.note})` : ''}` +
          (estWeeklyPct !== null ? `, ~${estWeeklyPct.toFixed(1)}% of weekly quota` : ''),
      );
      console.log(
        quota !== null
          ? `quota: ${quota.weeklyRemaining} ${quota.unit} weekly / ${quota.fiveHourRemaining} 5-hour remaining`
          : `quota: manual — before ${quotaBeforeFlag} (dashboard units)`,
      );

      // The run.
      const costRecords: CostRecord[] = [];
      for (const [p] of casesPerPhase) {
        perPhaseResults.set(
          p,
          await runL1(p, samples, dataset || undefined, (caseId, record) => {
            costRecords.push(record);
            console.log(
              `  cost ${caseId}: ${record.requests} requests, ${record.tokensIn} in / ${record.tokensOut} out`,
            );
          }),
        );
      }

      // Post-run actuals + the ledger row (D-Q).
      const totals = summarizeCost(costRecords);
      console.log(`\ncost: ${totals.requests} requests, ${totals.tokensIn} tokens in, ${totals.tokensOut} tokens out`);
      appendLedgerRow(LEDGER_PATH, {
        date: new Date().toISOString().slice(0, 10),
        command: `npm run evals -- ${process.argv.slice(2).join(' ')}`,
        scope: `L1 ${phase}${dataset !== '' ? `/${dataset}` : ''} (${caseCount}×${samples})`,
        requests: totals.requests,
        tokensIn: totals.tokensIn,
        tokensOut: totals.tokensOut,
        quotaBefore: quota !== null ? String(quota.weeklyRemaining) : quotaBeforeFlag,
        quotaAfter: '?',
        delta: '?',
        pctWeekly: '?',
      });
      const quotaAfter = readQuota();
      if (quotaAfter !== null) {
        completeLastRow(LEDGER_PATH, { quotaAfter: quotaAfter.weeklyRemaining, weeklyLimit });
        console.log('ledger row completed automatically (quota endpoint).');
      } else {
        console.log('ledger row appended — complete it: npm run evals:ledger -- --after <n>');
      }
    } else {
      console.error(`Level ${level} is not implemented yet (P0 ships L0 and L1).`);
      process.exit(2);
    }
  }

  const results = [...perPhaseResults.values()].flat();

  const baselineMode = argValue('--baseline', '');
  const baselineVersion = argValue('--baseline-version', 'v0');

  if (baselineMode === 'write') {
    const { loadConfig } = await import('@config/index');
    const { writeBaseline } = await import('./lib/baseline');
    const model = loadConfig().LLM_MODEL;
    for (const [p, phaseResults] of perPhaseResults) {
      const path = writeBaseline(baselineVersion, p, model, samples, phaseResults, dataset || undefined);
      console.log(`Baseline ${baselineVersion}/${p} written to ${path} (model ${model}, ${samples} samples)`);
    }
  } else if (baselineMode === 'compare') {
    const { compareToBaseline } = await import('./lib/baseline');
    for (const [p, phaseResults] of perPhaseResults) {
      let diff;
      try {
        diff = compareToBaseline(baselineVersion, p, phaseResults, dataset || undefined);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(2);
      }
      console.log(
        `vs baseline ${baselineVersion}/${p}: ${diff.regressions.length} regressions, ${diff.improvements.length} improvements, ${diff.missing.length} missing, ${diff.added.length} new checks`,
      );
      for (const r of diff.regressions) {
        console.error(`REGRESSION  ${r.case} :: ${r.check}`);
      }
    }
  }

  const report = buildReport(level, results);
  printReport(report);
  process.exit(exitCodeFor(report));
}

void main();
