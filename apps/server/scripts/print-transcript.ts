/**
 * AC-AT-5: one command that prints everything about a run or a session — the durable record this
 * whole plan built (Tasks 1–6), not the ephemeral log. Read-only.
 *
 * Run: npm run print-transcript -- --run <runId> [--payloads]
 *      npm run print-transcript -- --session <sessionId> [--payloads]
 *      npm run print-transcript -- --user <userId> --since <ISO> --until <ISO> [--payloads]
 *
 * `--payloads` resolves the request/response actually sent — off by default, since a run's request
 * can carry the whole conversation history (AC-AT-6's own volume note: 100–250 KB per run).
 */
import { pool } from '@infra/db/drizzle';

import {
  fetchRunsForUserWindow,
  fetchRunTranscript,
  resolvePromptBlobs,
  resolveSessionWindow,
  type RunTranscript,
} from '@infra/observability/transcript-reader';
import { formatTranscripts } from '@infra/observability/transcript-formatter';

function usageError(message: string): never {
  console.error(`${message}\n`);
  console.error('Usage:');
  console.error('  npm run print-transcript -- --run <runId> [--payloads]');
  console.error('  npm run print-transcript -- --session <sessionId> [--payloads]');
  console.error('  npm run print-transcript -- --user <userId> --since <ISO> --until <ISO> [--payloads]');
  process.exit(2);
}

function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx === -1 ? undefined : args[idx + 1];
}

function parseDate(label: string, value: string | undefined): Date {
  if (!value) {
    return usageError(`--user requires --since and --until (missing ${label})`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return usageError(`${label} is not a valid date: ${value}`);
  }
  return parsed;
}

async function resolveTranscripts(args: string[]): Promise<RunTranscript[]> {
  const runId = argValue(args, '--run');
  const sessionId = argValue(args, '--session');
  const userId = argValue(args, '--user');

  if (runId) {
    return [await fetchRunTranscript(runId)];
  }
  if (sessionId) {
    const window = await resolveSessionWindow(sessionId);
    if (!window) {
      usageError(`No workout session found for id ${sessionId}`);
    }
    return fetchRunsForUserWindow(window.userId, window.since, window.until);
  }
  if (userId) {
    const since = parseDate('--since', argValue(args, '--since'));
    const until = parseDate('--until', argValue(args, '--until'));
    return fetchRunsForUserWindow(userId, since, until);
  }
  return usageError('One of --run, --session or --user is required');
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const includePayloads = args.includes('--payloads');

  const transcripts = await resolveTranscripts(args);
  const allCalls = transcripts.flatMap(t => t.llmCalls);
  const blobs = includePayloads ? await resolvePromptBlobs(allCalls) : new Map<string, string | null>();

  console.log(formatTranscripts(transcripts, blobs, { includePayloads }));
}

run()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
