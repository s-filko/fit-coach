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

  if (level !== 'L0') {
    console.error(`Level ${level} is not implemented yet (P0 ships L0; L1 follows).`);
    process.exit(2);
  }

  const results = await runL0(phase);
  const report = buildReport(level, results);
  printReport(report);
  process.exit(exitCodeFor(report));
}

void main();
