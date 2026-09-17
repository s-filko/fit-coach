/**
 * Eval runner — see docs/PROMPT_EVAL_FRAMEWORK.md.
 * Usage: npm run evals -- --level L0|L1 [--phase chat|all] [--samples 3]
 *                    [--baseline write|compare] [--baseline-version v0]
 */
import { EVAL_PHASES, runL0 } from './levels/l0';
import { buildReport, type CheckResult, exitCodeFor, printReport } from './lib/reporter';

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  const level = argValue('--level', 'L0').toUpperCase();
  const phase = argValue('--phase', 'all');

  const samples = Number(argValue('--samples', '3'));

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
    for (const p of phases) {
      if (level === 'L1') {
        if (process.env['RUN_LLM_EVALS'] !== '1') {
          console.log('L1 skipped: set RUN_LLM_EVALS=1 to run evals against a real model.');
          process.exit(0);
        }
        const { runL1 } = await import('./levels/l1');
        perPhaseResults.set(p, await runL1(p, samples));
      } else {
        console.error(`Level ${level} is not implemented yet (P0 ships L0 and L1).`);
        process.exit(2);
      }
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
      const path = writeBaseline(baselineVersion, p, model, samples, phaseResults);
      console.log(`Baseline ${baselineVersion}/${p} written to ${path} (model ${model}, ${samples} samples)`);
    }
  } else if (baselineMode === 'compare') {
    const { compareToBaseline } = await import('./lib/baseline');
    for (const [p, phaseResults] of perPhaseResults) {
      const diff = compareToBaseline(baselineVersion, p, phaseResults);
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
