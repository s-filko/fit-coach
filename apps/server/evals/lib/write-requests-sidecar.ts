/**
 * The requests sidecar (coach-quality-proof T3 / AC-CQ-3): right after an L3
 * scenario run, persist — next to the transcript md — the evidence the
 * coach-quality judge needs per run id: the coach call's user message
 * (with its <context> facts) and every tool call with arguments, read from
 * `llm_calls` in the SAME process. The DB rows are ephemeral on this host
 * (every jest DB suite resets the schema), so judging from the DB alone is
 * fragile; the sidecar is the durable copy.
 *
 * SELF-CONTAINED ON PURPOSE: this one file is copied verbatim into the
 * baseline-dev worktree, where the same run.ts wiring writes the same sidecar
 * for the baseline transcripts — no other module of this plan is needed
 * (everything below is dynamic imports + node:fs).
 */
import { writeFileSync } from 'node:fs';

/** What the rubric needs for one run — nothing more. */
export interface SidecarRunEvidence {
  /** The <context>-carrying user message of the run's coach call ('' when none was stored). */
  requestContext: string;
  /** The coach call's resolved system message (profile, history, rules) — llm_calls keeps it as a hash only. */
  coachSystem: string;
  /** Every tool call of the run with its arguments, in call order. */
  toolCalls: Array<{ name: string; args: unknown }>;
}

/** One stored model call of a run. */
export interface StoredCall {
  callIndex: number;
  request: unknown;
  response: unknown;
}

type RequestMessages = { messages?: Array<{ role: string; content?: unknown; contentHash?: unknown }> } | null;

/** The userMessage of a stored request: its last `user` message with string content. */
function lastUserContent(request: unknown): string | null {
  const messages = (request as RequestMessages)?.messages ?? [];
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  return lastUser !== undefined && typeof lastUser.content === 'string' ? lastUser.content : null;
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
 * prompt_blobs (`blobs` = the resolved map, as print-transcript --payloads uses); a missing or pruned blob is
 * said in the text, never silently empty.
 */
export function resolveSystemText(request: unknown, blobs: ReadonlyMap<string, string | null>): string {
  const messages = (request as RequestMessages)?.messages ?? [];
  return messages
    .filter(m => m.role === 'system')
    .map(m => {
      if (typeof m.contentHash === 'string') {
        if (!blobs.has(m.contentHash)) {
          return `(system prompt ${m.contentHash} not found in prompt_blobs)`;
        }
        return blobs.get(m.contentHash) ?? `(system prompt ${m.contentHash} aged out — retention pruned it)`;
      }
      return typeof m.content === 'string' ? m.content : '';
    })
    .join('\n\n');
}

/**
 * Collects one run's evidence from `llm_calls` (best effort — a read error
 * becomes `{ error }` in the sidecar, never a crash of the L3 run).
 */
export async function collectRunEvidence(runId: string): Promise<SidecarRunEvidence> {
  // Dynamic: importing the pool at module load would open a DB connection even
  // where this module is only copied around.
  const { db } = await import('@infra/db/drizzle');
  const { llmCalls } = await import('@infra/db/schema');
  const { eq } = await import('drizzle-orm');
  const rows = (await db
    .select({ callIndex: llmCalls.callIndex, request: llmCalls.request, response: llmCalls.response, promptHashes: llmCalls.promptHashes })
    .from(llmCalls)
    .where(eq(llmCalls.runId, runId))
    .orderBy(llmCalls.callIndex)) as Array<StoredCall & { promptHashes: string[] | null }>;

  const toolCalls: Array<{ name: string; args: unknown }> = [];
  for (const row of rows) {
    const calls = (row.response as { toolCalls?: Array<{ name?: unknown; args?: unknown }> | null } | null)?.toolCalls ?? [];
    for (const call of calls) {
      toolCalls.push({ name: String(call.name ?? '?'), args: call.args ?? {} });
    }
  }
  const coach = pickCoachCall(rows);
  const requestContext = coach === undefined ? '' : (lastUserContent(coach.request) ?? '');
  let coachSystem = '';
  if (coach !== undefined) {
    // The same resolution print-transcript --payloads uses.
    const { resolvePromptBlobs } = await import('@infra/observability/transcript-reader');
    const blobs = await resolvePromptBlobs([coach] as never);
    coachSystem = resolveSystemText(coach.request, blobs);
  }
  return { requestContext, coachSystem, toolCalls };
}

/**
 * Writes `<transcriptPath>.requests.json` — `{ [runId]: evidence | { error } }`
 * for every distinct run id. Called by the L3 runner between the transcript
 * write and the next scenario; the judge reads the sidecar first and falls
 * back to the DB only when it is absent.
 */
export async function writeRequestsSidecar(transcriptPath: string, runIds: readonly string[]): Promise<void> {
  const sidecar: Record<string, SidecarRunEvidence | { error: string }> = {};
  for (const runId of new Set(runIds)) {
    try {
      sidecar[runId] = await collectRunEvidence(runId);
    } catch (err) {
      sidecar[runId] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  writeFileSync(`${transcriptPath}.requests.json`, JSON.stringify(sidecar, null, 2));
}
