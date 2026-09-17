/**
 * Export redacted production runs as draft eval cases.
 * Usage: npm run evals:export -- --since 2026-09-01 [--limit 200]
 *
 * Output is a DRAFT: each record has no `expect` block. A human adds the
 * expectations and moves the case into evals/datasets/ (BR-EVAL-003, §3).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildDraftCase } from './lib/draft-case';
import { fetchRunsSince } from './lib/export-query';

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  const sinceArg = argValue('--since', '');
  if (!sinceArg) {
    console.error('Usage: npm run evals:export -- --since YYYY-MM-DD [--limit 200]');
    process.exit(2);
  }
  const since = new Date(sinceArg);
  if (Number.isNaN(since.getTime())) {
    console.error(`Not a date: ${sinceArg}`);
    process.exit(2);
  }
  const limit = Number(argValue('--limit', '200'));

  const runs = await fetchRunsSince(since, limit);

  const { db } = await import('@infra/db/drizzle');
  const { users } = await import('@infra/db/schema');
  const userRows = await db.select().from(users);
  const usersById = new Map(userRows.map(u => [u.id, u as unknown as Record<string, unknown>]));

  const lines: string[] = [];
  let skippedEmpty = 0;

  for (const run of runs) {
    if (run.turns.length === 0) {
      skippedEmpty += 1;
      continue;
    }
    const user = usersById.get(run.userId) ?? {};
    const draft = buildDraftCase(run, user);
    if (!draft) {
      skippedEmpty += 1;
      continue;
    }
    lines.push(JSON.stringify(draft));
  }

  const outDir = join(import.meta.dirname, 'exports');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');

  // Counts and paths only — never message content (LOGGING_GUIDE).
  console.log(`Exported ${lines.length} draft cases to ${outPath} (${skippedEmpty} runs skipped: no usable turns)`);
}

void main();
