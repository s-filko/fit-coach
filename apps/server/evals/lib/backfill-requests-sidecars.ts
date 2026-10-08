/**
 * One-off backfill (coach-quality-proof T3): regenerate `<transcript>.requests.json` sidecars for EXISTING L3
 * transcripts from `llm_calls` (+ prompt_blobs) of the test DB, where those rows still exist.
 *
 *   npm run backfill:sidecars -- <reports-dir> [<reports-dir> …] [--force]
 *
 * Needs the test DB env (the script loads `.env.test` when run through the npm script). A transcript that
 * already has a sidecar WITH `coachSystem` is skipped unless `--force`. A run counts as resolved when the
 * regenerated entry has a coach request context; the rest are listed — their rows are gone (the DB resets).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { closePool } from './cli-args';
import { parseTranscriptMarkdown } from './transcript-parser';
import { collectRunEvidence, writeRequestsSidecar } from './write-requests-sidecar';

/** The distinct run ids a transcript md mentions (`run:` lines), in order. */
export function runIdsOfTranscript(md: string): string[] {
  const ids = parseTranscriptMarkdown(md)
    .steps.map(s => s.runId)
    .filter((id): id is string => id !== null);
  return [...new Set(ids)];
}

/** True when the transcript's sidecar exists and already carries the system message of every entry. */
export function sidecarIsCurrent(sidecarRaw: string): boolean {
  try {
    const parsed = JSON.parse(sidecarRaw) as Record<string, { coachSystem?: unknown; error?: unknown }>;
    const entries = Object.values(parsed);
    return entries.length > 0 && entries.every(e => typeof e.coachSystem === 'string' && e.coachSystem !== '');
  } catch {
    return false;
  }
}

export interface BackfillReport {
  transcripts: number;
  skipped: number;
  runsTotal: number;
  runsResolved: number;
  unresolved: string[];
}

export async function backfillDir(dir: string, force: boolean): Promise<BackfillReport> {
  const report: BackfillReport = { transcripts: 0, skipped: 0, runsTotal: 0, runsResolved: 0, unresolved: [] };
  for (const name of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    const path = join(dir, name);
    const runIds = runIdsOfTranscript(readFileSync(path, 'utf8'));
    if (runIds.length === 0) {
      continue;
    }
    const sidecarPath = `${path}.requests.json`;
    if (!force && existsSync(sidecarPath) && sidecarIsCurrent(readFileSync(sidecarPath, 'utf8'))) {
      report.skipped += 1;
      continue;
    }
    report.transcripts += 1;
    // Rows that are gone are not written; writeRequestsSidecar merges into the old sidecar, never dropping entries.
    const resolvable: string[] = [];
    for (const runId of runIds) {
      report.runsTotal += 1;
      try {
        const evidence = await collectRunEvidence(runId);
        if (evidence.requestContext !== '') {
          resolvable.push(runId);
          report.runsResolved += 1;
          continue;
        }
      } catch {
        // fall through: unresolved
      }
      report.unresolved.push(`${name} ${runId}`);
    }
    if (resolvable.length > 0) {
      await writeRequestsSidecar(path, resolvable);
    }
  }
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dirs = args.filter(a => !a.startsWith('--'));
  if (dirs.length === 0) {
    console.error('usage: npm run backfill:sidecars -- <reports-dir> [<reports-dir> …] [--force]');
    process.exit(1);
  }
  let resolved = 0;
  let total = 0;
  for (const dir of dirs) {
    const r = await backfillDir(dir, force);
    resolved += r.runsResolved;
    total += r.runsTotal;
    console.log(`${dir}: ${r.transcripts} transcripts rewritten, ${r.skipped} already current, runs resolved ${r.runsResolved}/${r.runsTotal}`);
    for (const u of r.unresolved) {
      console.log(`  unresolved: ${u}`);
    }
  }
  console.log(`TOTAL runs resolved ${resolved}/${total}`);
  await closePool().catch(() => undefined);
}

if (process.argv[1]?.endsWith('backfill-requests-sidecars.ts')) {
  void main();
}
