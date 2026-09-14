/**
 * Eval runner — see docs/PROMPT_EVAL_FRAMEWORK.md.
 * Usage: npm run evals -- --level L0 [--phase chat|all]
 */
import { runL0 } from './levels/l0';
import { buildReport, exitCodeFor, printReport } from './lib/reporter';

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  const level = argValue('--level', 'L0').toUpperCase();
  const phase = argValue('--phase', 'all');

  const samples = Number(argValue('--samples', '3'));

  let results;
  if (level === 'L0') {
    results = await runL0(phase);
  } else if (level === 'L1') {
    if (process.env['RUN_LLM_EVALS'] !== '1') {
      console.log('L1 skipped: set RUN_LLM_EVALS=1 to run evals against a real model.');
      process.exit(0);
    }
    const { runL1 } = await import('./levels/l1');
    results = await runL1(phase, samples);
  } else {
    console.error(`Level ${level} is not implemented yet (P0 ships L0 and L1).`);
    process.exit(2);
  }
  const report = buildReport(level, results);
  printReport(report);
  process.exit(exitCodeFor(report));
}

void main();
