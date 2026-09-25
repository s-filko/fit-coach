/**
 * Eval runner — see docs/PROMPT_EVAL_FRAMEWORK.md.
 * Usage: npm run evals -- --level L0|L1|L3 [--phase chat|all] [--samples 3]
 *                    [--dataset <stem>] [--baseline write|compare] [--baseline-version v0]
 *                    [--quota-before <n>] | --level L3 [--scenario <id>] [--samples 1]
 *
 * Red button (§7a, D-P): every L1 run prints its planned model calls before
 * anything runs and refuses above EVALS_CALL_CEILING (default 30) unless
 * EVALS_FULL_RUN=1 is set (owner-launched).
 *
 * Metering (D-Q): every L1 run prints requests/tokens per case and in total,
 * and appends a row to evals/COST_LEDGER.md. Quota is read automatically when
 * readQuota() finds an endpoint (D-R: none confirmed as of 2026-09-18), else
 * via --quota-before <n> and completed with `npm run evals:ledger -- --after <n>`.
 *
 * L3 (live scenarios, owner-launched only): the same journeys the
 * deterministic layer runs, with the REAL model over the test DB — see
 * evals/datasets/README.md § L3 for the manual launch command. Every L3 run
 * also prints a per-step transcript and writes it to evals/reports/ (AC-SM-2);
 * `npm run smoke` is the one-command L3 run of the smoke scenario.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { disposeAllEmbeddingServices } from '@infra/ai/embedding.service';

import { EVAL_PHASES, runL0 } from './levels/l0';
import { loadCases, runL1 } from './levels/l1';
import { loadScenarios, runL3 } from './levels/l3';
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
import { buildReport, type CheckResult, exitCodeFor, formatScenarioTranscript, printReport } from './lib/reporter';

const LEDGER_PATH = join(process.cwd(), 'evals', 'COST_LEDGER.md');
/** AC-SM-2: every L3 run's per-step transcripts land here as <scenario>-<ISO>.md (gitignored). */
const REPORTS_DIR = join(process.cwd(), 'evals', 'reports');

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

/**
 * The two real teardown effects `runWithCleanup` performs — injectable so the
 * wrapper can be unit tested with fakes (close-out review advisory 2), never
 * touching a live embedding pipeline or a real Postgres pool.
 */
export interface CleanupDeps {
  disposeEmbeddings: () => Promise<void>;
  /** Closes the DB pool. Only called when `operation` reported one might be open. */
  closePool: () => Promise<void>;
}

const realCleanupDeps: CleanupDeps = {
  disposeEmbeddings: disposeAllEmbeddingServices,
  closePool: async () => {
    const { pool } = await import('@infra/db/drizzle');
    await pool.end();
  },
};

/**
 * Runs `operation` and returns the exit code it resolves to (or
 * `fallbackErrorCode` if it throws), and — no matter which, including a throw
 * from ANYWHERE inside `operation`, not just its normal-completion path —
 * disposes the embedding pipeline and, if `operation` ever called the
 * `markPoolMayBeOpen` callback it's given, closes the DB pool. Both run
 * exactly once each, in a `finally`, so neither can be skipped by an early
 * `return`/`throw` inside `operation` and neither can fire twice — a
 * rejecting `closePool()` is caught right here, not left to propagate and
 * make an outer handler retry it (pg rejects a second `pool.end()` with
 * "Called end on pool more than once").
 *
 * Exit 134 (close-out review, first two live runs): a live L3 run loads the
 * shared embedding pipeline's native ONNX session (search_exercises) — a
 * throwaway repro (load it, dispose it, then `process.exit()`) reproduced
 * `libc++abi … mutex lock failed` every time. `disposeEmbeddings()`
 * resolving only means the JS-visible teardown call returned, not that the
 * native thread pool has actually unwound; `process.exit()` tears the
 * process down before it can. The caller therefore sets `process.exitCode`
 * from this function's return value and never calls `process.exit()` —
 * Node's normal, un-forced exit lets that native unwind finish on its own,
 * the same mechanism jest already relies on (`jest.config.cjs`'s
 * `forceExit: false` + `src/app/test/setup.ts`'s `afterAll`).
 */
export async function runWithCleanup(
  operation: (markPoolMayBeOpen: () => void) => Promise<number>,
  deps: CleanupDeps,
  fallbackErrorCode = 1,
): Promise<number> {
  let poolMayBeOpen = false;
  let code: number;
  try {
    code = await operation(() => {
      poolMayBeOpen = true;
    });
  } catch (err) {
    console.error(err);
    code = fallbackErrorCode;
  } finally {
    await deps.disposeEmbeddings();
    if (poolMayBeOpen) {
      await deps.closePool().catch(err => {
        console.error('DB pool cleanup failed:', err);
      });
    }
  }
  return code;
}

function ledgerText(): string {
  return existsSync(LEDGER_PATH) ? readFileSync(LEDGER_PATH, 'utf8') : '';
}

async function main(markPoolMayBeOpen: () => void): Promise<number> {
  const level = argValue('--level', 'L0').toUpperCase();
  const phase = argValue('--phase', 'all');
  // L3's default is one pass per journey — a live journey is many turns long.
  const samples = Number(argValue('--samples', level === 'L3' ? '1' : '3'));
  const dataset = argValue('--dataset', '');
  const baselineMode = argValue('--baseline', '');

  if (dataset !== '' && phase === 'all') {
    console.error('--dataset requires --phase <phase> — a dataset lives in one phase directory');
    return 2;
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
        return 0;
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
        return 3;
      }

      // D-R/D-Q quota gate + pre-run estimate banner.
      const quota = await readQuota();
      const quotaBeforeFlag = argValue('--quota-before', '');
      if (quota === null && quotaBeforeFlag === '') {
        console.error(
          'L1 requires --quota-before <n> (the Z.AI dashboard number): no quota endpoint is readable (D-R). ' +
            'Complete the ledger row afterwards with: npm run evals:ledger -- --after <n>',
        );
        return 2;
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
      const quotaAfter = await readQuota();
      if (quotaAfter !== null) {
        completeLastRow(LEDGER_PATH, { quotaAfter: quotaAfter.weeklyRemaining, weeklyLimit });
        console.log('ledger row completed automatically (quota endpoint).');
      } else {
        console.log('ledger row appended — complete it: npm run evals:ledger -- --after <n>');
      }
    } else if (level === 'L3') {
      if (baselineMode !== '') {
        console.error('L3 does not support --baseline (scenarios are not a per-phase baseline source).');
        return 2;
      }
      const scenarioId = argValue('--scenario', '');
      let scenarios;
      try {
        scenarios = loadScenarios(scenarioId || undefined);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        return 2;
      }
      const outcome = await runL3(scenarios, samples, {
        // Fires exactly once `runL3` has passed every gate and is about to
        // lazily import `run-scenario.ts` (which opens the real DB pool) —
        // BEFORE that import and BEFORE the scenario loop, so a throw
        // anywhere after this point (including the import itself, or mid-run)
        // still leaves `runWithCleanup` knowing to close the pool.
        onPlanned: info => {
          console.log(
            `planned model calls: ${info.plannedCalls} (${info.userSteps} user steps × ${info.samples} samples, ceiling ${info.ceiling})`,
          );
          markPoolMayBeOpen();
        },
      });
      if (outcome.status === 'skipped') {
        console.log(outcome.message);
        return 0;
      }
      if (outcome.status === 'refused') {
        console.error(outcome.message);
        return 3;
      }
      perPhaseResults.set('scenarios', outcome.results);
      // AC-SM-2: the readable per-step transcript — stdout and file, one
      // formatter for every L3 run (see reporter.formatScenarioTranscript).
      mkdirSync(REPORTS_DIR, { recursive: true });
      for (const transcript of outcome.transcripts) {
        const body = formatScenarioTranscript(transcript);
        console.log(body);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportPath = join(REPORTS_DIR, `${transcript.scenarioId}-${stamp}.md`);
        writeFileSync(reportPath, `# L3 transcript: ${transcript.scenarioId} (${stamp})\n\n${body}\n`);
        console.log(`transcript written to ${reportPath}`);
      }
    } else {
      console.error(`Level ${level} is not implemented yet (P0 ships L0, L1 and L3).`);
      return 2;
    }
  }

  const results = [...perPhaseResults.values()].flat();

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
        return 2;
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
  return exitCodeFor(report);
}

void runWithCleanup(main, realCleanupDeps).then(code => {
  process.exitCode = code;
});
