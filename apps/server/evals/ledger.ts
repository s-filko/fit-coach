/**
 * Ledger completion CLI (D-Q/D-R): fills the last COST_LEDGER.md row after the
 * owner reads the quota from the Z.AI dashboard.
 *
 * Usage: npm run evals:ledger -- --after <n>
 *
 * `EVALS_WEEKLY_LIMIT` (the plan's stated weekly cap, in the dashboard's
 * units) must be set in .env for the `% of weekly` column.
 */
import { join } from 'node:path';

import { completeLastRow } from './lib/cost-ledger';

function argValue(flag: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? '') : '';
}

const after = Number(argValue('--after'));
if (!Number.isFinite(after) || after <= 0) {
  console.error('Usage: npm run evals:ledger -- --after <n>  (n = quota remaining, dashboard units)');
  process.exit(2);
}

const weeklyLimit = process.env['EVALS_WEEKLY_LIMIT'] ? Number(process.env['EVALS_WEEKLY_LIMIT']) : undefined;
if (weeklyLimit === undefined) {
  console.warn('EVALS_WEEKLY_LIMIT is not set — the % of weekly column will stay "?"');
}

const path = join(process.cwd(), 'evals', 'COST_LEDGER.md');
completeLastRow(path, { quotaAfter: after, weeklyLimit });
console.log(`ledger row completed at ${path} (quota after ${after})`);
