/**
 * The requests sidecar (coach-quality-proof T3 / AC-CQ-3): right after an L3
 * scenario run, persist — next to the transcript md — the evidence the
 * coach-quality judge needs per run id: the coach call's user message
 * (with its <context> facts) and every tool call with arguments, read from
 * `llm_calls` in the SAME process. The DB rows are ephemeral on this host
 * (every jest DB suite resets the schema), so judging from the DB alone is
 * fragile; the sidecar is the durable copy.
 *
 * It reuses the observability reader (fetchRunTranscript, resolvePromptBlobs) and the formatter's
 * describeSystemBlob rather than re-querying; a baseline-dev worktree that copies this file with the same run.ts
 * wiring needs those two modules (and evals/lib/cli-args.ts is NOT needed here) at the same revision.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { describeSystemBlob } from '@infra/observability/transcript-formatter';

/** What the rubric needs for one run — nothing more. */
export interface SidecarRunEvidence {
  /** The <context>-carrying user message of the run's coach call ('' when none was stored). */
  requestContext: string;
  /** The coach call's resolved system message (profile, history, rules) — llm_calls keeps it as a hash only. */
  coachSystem: string;
  /** Every tool call of the run with its arguments, in call order. */
  toolCalls: Array<{ name: string; args: unknown }>;
}

/** One stored model call of a run (a structural subset of transcript-reader's LlmCallRecord). */
export interface StoredCall {
  callIndex: number;
  request: unknown;
  response: unknown;
}

type RequestMessages = { messages?: Array<{ role: string; content?: unknown; contentHash?: unknown }> } | null;

/** A message's text: a string as is, a multipart content (array of text parts) joined; null for anything else. */
function textOfContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content.map(part =>
      typeof part === 'string' ? part : typeof (part as { text?: unknown })?.text === 'string' ? (part as { text: string }).text : '',
    );
    return parts.join('\n');
  }
  return null;
}

/** The last `user` message of a stored request, as text. */
function lastUserContent(request: unknown): string | null {
  const messages = (request as RequestMessages)?.messages ?? [];
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  return lastUser === undefined ? null : textOfContent(lastUser.content);
}

/**
 * The COACH call: the last call whose request carries a `<context>` block. The last stored call of a run can be
 * a course-check or summariser call (no `<context>`), which would hand the judge the wrong request.
 */
export function pickCoachCall<T extends StoredCall>(rows: readonly T[]): T | undefined {
  let found: T | undefined;
  for (const row of rows) {
    if (lastUserContent(row.request)?.includes('<context>') === true) {
      found = row;
    }
  }
  return found;
}

/** The user message of the coach call ('' when no call carries a `<context>` block). */
export function pickCoachContext(rows: readonly StoredCall[]): string {
  const row = pickCoachCall(rows);
  return row === undefined ? '' : (lastUserContent(row.request) ?? '');
}

/**
 * The system message(s) of a stored request as text. llm_calls stores them as `{ contentHash }` pointing at
 * prompt_blobs (`blobs` = the resolved map, as print-transcript --payloads uses); the hash → text step is the
 * formatter's `describeSystemBlob`, so a missing or pruned blob is said in the text, never silently empty.
 */
export function resolveSystemText(request: unknown, blobs: ReadonlyMap<string, string | null>): string {
  const messages = (request as RequestMessages)?.messages ?? [];
  return messages
    .filter(m => m.role === 'system')
    .map(m => {
      if (typeof m.contentHash === 'string') {
        const blob = describeSystemBlob(m.contentHash, blobs);
        return 'content' in blob ? blob.content : blob.note;
      }
      return textOfContent(m.content) ?? '';
    })
    .join('\n\n');
}

/** One tool call as a text line — the one format the sidecar reader and the DB fallback share. */
export function formatToolCallLine(call: { name?: unknown; args?: unknown }): string {
  return `${String(call.name ?? '?')} ${JSON.stringify(call.args ?? {})}`;
}

/** Every tool call of every stored model call of a run, in call order — not only the coach call's. */
export function toolCallsOfRows(rows: ReadonlyArray<Pick<StoredCall, 'response'>>): Array<{ name: string; args: unknown }> {
  const toolCalls: Array<{ name: string; args: unknown }> = [];
  for (const row of rows) {
    const calls = (row.response as { toolCalls?: Array<{ name?: unknown; args?: unknown }> | null } | null)?.toolCalls ?? [];
    for (const call of calls) {
      toolCalls.push({ name: String(call.name ?? '?'), args: call.args ?? {} });
    }
  }
  return toolCalls;
}

/**
 * Collects one run's evidence from `llm_calls` via the observability reader (the same rows and blob resolution
 * print-transcript --payloads uses). A read error propagates; the caller records it as `{ error }`.
 */
export async function collectRunEvidence(runId: string): Promise<SidecarRunEvidence> {
  // Dynamic: importing the reader at module load would open a DB connection even where this module is
  // only copied around.
  const { fetchRunTranscript, resolvePromptBlobs } = await import('@infra/observability/transcript-reader');
  const { llmCalls: rows } = await fetchRunTranscript(runId);

  const toolCalls = toolCallsOfRows(rows);
  const coach = pickCoachCall(rows);
  const requestContext = coach === undefined ? '' : (lastUserContent(coach.request) ?? '');
  const coachSystem = coach === undefined ? '' : resolveSystemText(coach.request, await resolvePromptBlobs([coach]));
  return { requestContext, coachSystem, toolCalls };
}

type SidecarFile = Record<string, SidecarRunEvidence | { error: string }>;

/**
 * Old entries plus fresh ones: a fresh entry replaces the old of the same run id, except an `{ error }` never
 * overwrites a good entry; entries absent from `fresh` are kept — a regeneration never drops evidence.
 */
export function mergeSidecars(old: SidecarFile, fresh: SidecarFile): SidecarFile {
  const merged: SidecarFile = { ...old };
  for (const [runId, entry] of Object.entries(fresh)) {
    if ('error' in entry && merged[runId] !== undefined && !('error' in merged[runId]!)) {
      continue;
    }
    merged[runId] = entry;
  }
  return merged;
}

/**
 * Writes `<transcriptPath>.requests.json` — `{ [runId]: evidence | { error } }` for every distinct run id,
 * merged into an existing sidecar of the same transcript (never dropping its entries). Called by the L3 runner
 * between the transcript write and the next scenario; the judge reads the sidecar first and falls back to the
 * DB only when it is absent.
 */
export async function writeRequestsSidecar(transcriptPath: string, runIds: readonly string[]): Promise<void> {
  const fresh: SidecarFile = {};
  for (const runId of new Set(runIds)) {
    try {
      fresh[runId] = await collectRunEvidence(runId);
    } catch (err) {
      fresh[runId] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  const path = `${transcriptPath}.requests.json`;
  let old: SidecarFile = {};
  if (existsSync(path)) {
    try {
      old = JSON.parse(readFileSync(path, 'utf8')) as SidecarFile;
    } catch {
      old = {};
    }
  }
  writeFileSync(path, JSON.stringify(mergeSidecars(old, fresh), null, 2));
}
