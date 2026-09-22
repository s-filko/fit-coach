/**
 * AC-AT-5: read-only fetches for `print-transcript` — the one command that reconstructs a run or a
 * session from the durable record this plan built (conversation_runs/conversation_turns from Tasks
 * 1–3, llm_calls/prompt_blobs from Tasks 4–6). No writes; INV-LLM-001 is unaffected (this never
 * builds a prompt, it prints one that already happened).
 */
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';

import { db } from '@infra/db/drizzle';
import { conversationRuns, conversationTurns, llmCalls, promptBlobs, workoutSessions } from '@infra/db/schema';

export interface RunSummary {
  runId: string;
  userId: string;
  createdAt: Date;
  phaseIn: string;
  phaseOut: string | null;
  model: string | null;
  outcome: string;
  errorClass: string | null;
  errorMessage: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
}

export interface TurnRecord {
  kind: string;
  role: string;
  content: string;
  payload: unknown;
  seq: number | null;
  createdAt: Date;
}

export interface LlmCallRecord {
  callIndex: number;
  model: string;
  request: unknown | null;
  response: unknown | null;
  promptHashes: string[] | null;
  latencyMs: number;
  errorClass: string | null;
  errorMessage: string | null;
  createdAt: Date;
}

/**
 * Everything known about one run — `run` is null for a run_id no conversation_runs row was ever
 * written for (a compact-only pass, or the row insert itself failing).
 */
export interface RunTranscript {
  runId: string;
  run: RunSummary | null;
  turns: TurnRecord[];
  llmCalls: LlmCallRecord[];
}

/**
 * The 12-field `conversation_runs` row → `RunSummary` projection — one place, used by both the
 * single-run and the windowed fetch below (close-out R2 finding 5; `loadTurnsAndCalls` above was
 * factored out for exactly the same reason).
 */
function toRunSummary(runRow: typeof conversationRuns.$inferSelect): RunSummary {
  return {
    runId: runRow.runId,
    userId: runRow.userId,
    createdAt: runRow.createdAt,
    phaseIn: runRow.phaseIn,
    phaseOut: runRow.phaseOut,
    model: runRow.model,
    outcome: runRow.outcome,
    errorClass: runRow.errorClass,
    errorMessage: runRow.errorMessage,
    tokensIn: runRow.tokensIn,
    tokensOut: runRow.tokensOut,
    latencyMs: runRow.latencyMs,
  };
}

async function loadTurnsAndCalls(runId: string): Promise<Pick<RunTranscript, 'turns' | 'llmCalls'>> {
  const [turns, calls] = await Promise.all([
    db
      .select({
        kind: conversationTurns.kind,
        role: conversationTurns.role,
        content: conversationTurns.content,
        payload: conversationTurns.payload,
        seq: conversationTurns.seq,
        createdAt: conversationTurns.createdAt,
      })
      .from(conversationTurns)
      .where(eq(conversationTurns.runId, runId))
      // AC-AT-4: (created_at, seq) — the ordering this plan made recoverable, never seq alone
      // (Task 3's own review finding: seq restarts at 1 per run, so it is only ever a same-timestamp
      // tiebreak, and NULLS LAST here is exactly "a pre-migration row's order among ties is not
      // guaranteed", not silently reordered ahead of anything).
      .orderBy(asc(conversationTurns.createdAt), asc(conversationTurns.seq)),
    db
      .select({
        callIndex: llmCalls.callIndex,
        model: llmCalls.model,
        request: llmCalls.request,
        response: llmCalls.response,
        promptHashes: llmCalls.promptHashes,
        latencyMs: llmCalls.latencyMs,
        errorClass: llmCalls.errorClass,
        errorMessage: llmCalls.errorMessage,
        createdAt: llmCalls.createdAt,
      })
      .from(llmCalls)
      .where(eq(llmCalls.runId, runId))
      .orderBy(asc(llmCalls.callIndex)),
  ]);
  return { turns, llmCalls: calls };
}

export async function fetchRunTranscript(runId: string): Promise<RunTranscript> {
  const [runRow] = await db.select().from(conversationRuns).where(eq(conversationRuns.runId, runId));
  const { turns, llmCalls: calls } = await loadTurnsAndCalls(runId);
  return {
    runId,
    run: runRow ? toRunSummary(runRow) : null,
    turns,
    llmCalls: calls,
  };
}

function transcriptTimestamp(rt: Pick<RunTranscript, 'run' | 'turns'>): Date {
  return rt.run?.createdAt ?? rt.turns[0]?.createdAt ?? new Date(0);
}

/**
 * Every run of `userId` active in `[since, until]`, oldest first — including a run whose
 * `conversation_runs` row was never written (close-out R2 finding 8: `commit.node.ts:99-131`
 * swallows a `recordRun` failure, and a process killed before that point reaches neither path;
 * AC-AT-1 still guarantees the inbound message was persisted, keyed by `run_id`, before the graph
 * ran). Such a run is discovered from `conversation_turns` instead — the only one of the three
 * tables carrying `user_id` directly — and windowed by ITS OWN `created_at`, since there is no run
 * row to window by. `RunTranscript.run` is `null` for exactly this case; `--run` already returns it
 * that way, this just makes `--session`/`--user` find it too.
 */
export async function fetchRunsForUserWindow(userId: string, since: Date, until: Date): Promise<RunTranscript[]> {
  const runRows = await db
    .select()
    .from(conversationRuns)
    .where(
      and(
        eq(conversationRuns.userId, userId),
        gte(conversationRuns.createdAt, since),
        lte(conversationRuns.createdAt, until),
      ),
    );

  const knownRunIds = new Set(runRows.map(r => r.runId));

  const orphanRunIdRows = await db
    .selectDistinct({ runId: conversationTurns.runId })
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.userId, userId),
        gte(conversationTurns.createdAt, since),
        lte(conversationTurns.createdAt, until),
      ),
    );
  const orphanRunIds = orphanRunIdRows
    .map(row => row.runId)
    .filter((runId): runId is string => runId !== null && !knownRunIds.has(runId));

  const results = await Promise.all([
    ...runRows.map(async runRow => {
      const { turns, llmCalls: calls } = await loadTurnsAndCalls(runRow.runId);
      return { runId: runRow.runId, run: toRunSummary(runRow), turns, llmCalls: calls };
    }),
    ...orphanRunIds.map(async runId => {
      const { turns, llmCalls: calls } = await loadTurnsAndCalls(runId);
      return { runId, run: null, turns, llmCalls: calls };
    }),
  ]);

  return results.sort((a, b) => transcriptTimestamp(a).getTime() - transcriptTimestamp(b).getTime());
}

/** A training session's user + the time span it was active in — the window `--session` resolves to. */
export async function resolveSessionWindow(
  sessionId: string,
): Promise<{ userId: string; since: Date; until: Date } | null> {
  const [row] = await db.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId));
  if (!row) {
    return null;
  }
  return {
    userId: row.userId,
    since: row.startedAt ?? row.createdAt,
    until: row.completedAt ?? row.lastActivityAt ?? row.updatedAt,
  };
}

/**
 * Every distinct hash referenced anywhere in `calls`' requests, resolved in one query. A missing
 * key (not in the returned map) means the hash was never stored at all — should not happen; a
 * present key with a `null` value means the row exists but AC-AT-6's prune already dropped its
 * content.
 */
export async function resolvePromptBlobs(calls: LlmCallRecord[]): Promise<Map<string, string | null>> {
  const hashes = new Set<string>();
  for (const call of calls) {
    for (const hash of call.promptHashes ?? []) {
      if (hash) {
        hashes.add(hash);
      }
    }
  }
  if (hashes.size === 0) {
    return new Map();
  }
  const rows = await db
    .select({ hash: promptBlobs.hash, content: promptBlobs.content })
    .from(promptBlobs)
    .where(inArray(promptBlobs.hash, [...hashes]));
  return new Map(rows.map(r => [r.hash, r.content]));
}
