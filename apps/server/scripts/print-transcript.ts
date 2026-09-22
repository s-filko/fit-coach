/**
 * One command that prints everything about a run or a session — the durable record this
 * whole plan built (Tasks 1–6), not the ephemeral log. Read-only.
 *
 * Run: npm run print-transcript -- --run <runId> [--payloads] [--env-file <path>]
 *      npm run print-transcript -- --session <sessionId> [--payloads] [--env-file <path>]
 *      npm run print-transcript -- --user <userId> --since <ISO> --until <ISO> [--payloads] [--env-file <path>]
 *
 * `--payloads` resolves the request/response actually sent — off by default, since a run's request
 * can carry the whole conversation history (BR-LLM-011 measures ~150 KB per run across its 2–3
 * model calls).
 *
 * `--env-file <path>` picks which environment to read: the npm script wraps
 * this in `tsx --env-file-if-exists=.env`, so with no flag it reads whatever `.env` already means —
 * unchanged default behaviour for anyone used to it. `NODE_ENV=test` alone does NOT change that:
 * tsx's own `--env-file` is a fixed CLI flag, evaluated before this file's code ever runs, so setting
 * NODE_ENV in the shell has no effect on which file gets loaded — the exact silent mismatch that
 * sent this flag's `--env-file .env.test`, `--env-file .env.dev` (on the host running against the
 * dev container) override it explicitly instead. The imports that open a database connection are
 * deliberately dynamic, below, so they only resolve AFTER this flag has had a chance to load its
 * file — a static top-level `import` would have already opened the wrong connection by then.
 */
import path from 'node:path';

import dotenv from 'dotenv';

import type { RunTranscript } from '@infra/observability/transcript-reader';

function usageError(message: string): never {
  console.error(`${message}\n`);
  console.error('Usage:');
  console.error('  npm run print-transcript -- --run <runId> [--payloads] [--env-file <path>]');
  console.error('  npm run print-transcript -- --session <sessionId> [--payloads] [--env-file <path>]');
  console.error(
    '  npm run print-transcript -- --user <userId> --since <ISO> --until <ISO> [--payloads] [--env-file <path>]',
  );
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

async function resolveTranscripts(
  args: string[],
  reader: typeof import('@infra/observability/transcript-reader'),
): Promise<RunTranscript[]> {
  const runId = argValue(args, '--run');
  const sessionId = argValue(args, '--session');
  const userId = argValue(args, '--user');

  if (runId) {
    return [await reader.fetchRunTranscript(runId)];
  }
  if (sessionId) {
    const window = await reader.resolveSessionWindow(sessionId);
    if (!window) {
      usageError(`No workout session found for id ${sessionId}`);
    }
    return reader.fetchRunsForUserWindow(window.userId, window.since, window.until);
  }
  if (userId) {
    const since = parseDate('--since', argValue(args, '--since'));
    const until = parseDate('--until', argValue(args, '--until'));
    return reader.fetchRunsForUserWindow(userId, since, until);
  }
  return usageError('One of --run, --session or --user is required');
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const includePayloads = args.includes('--payloads');
  const envFile = argValue(args, '--env-file');
  if (envFile) {
    dotenv.config({ path: path.resolve(process.cwd(), envFile), override: true });
  }

  // Dynamic on purpose (see the header comment): resolving these now, not at module top, means the
  // --env-file override above has already run before anything opens a connection.
  const [{ pool }, reader, { formatTranscripts }, { formatDatabaseTarget, describeSchemaError }] = await Promise.all([
    import('@infra/db/drizzle'),
    import('@infra/observability/transcript-reader'),
    import('@infra/observability/transcript-formatter'),
    import('@infra/observability/db-target'),
  ]);

  const target = {
    host: String(pool.options.host),
    port: Number(pool.options.port),
    database: String(pool.options.database),
  };
  console.log(formatDatabaseTarget(target));

  try {
    const transcripts = await resolveTranscripts(args, reader);
    const allCalls = transcripts.flatMap(t => t.llmCalls);
    const blobs = includePayloads ? await reader.resolvePromptBlobs(allCalls) : new Map<string, string | null>();

    console.log(formatTranscripts(transcripts, blobs, { includePayloads }));
  } catch (err) {
    const friendly = describeSchemaError(err, target);
    if (friendly) {
      console.error(friendly);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    await pool.end();
  }
}

run().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
