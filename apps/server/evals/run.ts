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
 * Every exit point in `main()` funnels through here (success, guard refusal
 * or failure alike): a live L3 run can load the shared embedding pipeline's
 * native ONNX session (search_exercises), and an unreleased session outlives
 * `process.exit()`'s teardown and aborts with `libc++abi … mutex lock
 * failed` (exit 134) instead of the intended code — the same root cause
 * `src/app/test/setup.ts`'s `afterAll` releases for jest (coach-baseline
 * Task 1). `disposeAllEmbeddingServices()` is a no-op when nothing was ever
 * loaded (the common case: L0/L1, or an L3 gate refusal before any model
 * call), so this costs nothing on the paths that never touch embeddings.
 */
async function exitAfterCleanup(code: number): Promise<never> {
  await disposeAllEmbeddingServices();
  process.exit(code);
}

function ledgerText(): string {
  return existsSync(LEDGER_PATH) ? readFileSync(LEDGER_PATH, 'utf8') : '';
}

async function main(): Promise<void> {
  const level = argValue('--level', 'L0').toUpperCase();
  const phase = argValue('--phase', 'all');
  // L3's default is one pass per journey — a live journey is many turns long.
  const samples = Number(argValue('--samples', level === 'L3' ? '1' : '3'));
  const dataset = argValue('--dataset', '');
  const baselineMode = argValue('--baseline', '');

  if (dataset !== '' && phase === 'all') {
    console.error('--dataset requires --phase <phase> — a dataset lives in one phase directory');
    await exitAfterCleanup(2);
    return;
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
        await exitAfterCleanup(0);
        return;
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
        await exitAfterCleanup(3);
        return;
      }

      // D-R/D-Q quota gate + pre-run estimate banner.
      const quota = await readQuota();
      const quotaBeforeFlag = argValue('--quota-before', '');
      if (quota === null && quotaBeforeFlag === '') {
        console.error(
          'L1 requires --quota-before <n> (the Z.AI dashboard number): no quota endpoint is readable (D-R). ' +
            'Complete the ledger row afterwards with: npm run evals:ledger -- --after <n>',
        );
        await exitAfterCleanup(2);
        return;
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
        await exitAfterCleanup(2);
        return;
      }
      const scenarioId = argValue('--scenario', '');
      let scenarios;
      try {
        scenarios = loadScenarios(scenarioId || undefined);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        await exitAfterCleanup(2);
        return;
      }
      const outcome = await runL3(scenarios, samples, {
        onPlanned: info =>
          console.log(
            `planned model calls: ${info.plannedCalls} (${info.userSteps} user steps × ${info.samples} samples, ceiling ${info.ceiling})`,
          ),
      });
      if (outcome.status === 'skipped') {
        console.log(outcome.message);
        await exitAfterCleanup(0);
        return;
      }
      if (outcome.status === 'refused') {
        console.error(outcome.message);
        await exitAfterCleanup(3);
        return;
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
      await exitAfterCleanup(2);
      return;
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
        await exitAfterCleanup(2);
        return;
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
  await exitAfterCleanup(exitCodeFor(report));
}

void main().catch(async err => {
  console.error(err);
  await exitAfterCleanup(1);
});
