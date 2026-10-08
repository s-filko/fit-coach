/**
 * The requests sidecar (coach-quality-proof T3 / AC-CQ-3): right after an L3
 * scenario run, persist — next to the transcript md — the evidence the
 * coach-quality judge needs per run id: the last model call's user message
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
  /** The <context>-carrying user message of the run's LAST model call ('' when none was stored). */
  requestContext: string;
  /** Every tool call of the run with its arguments, in call order. */
  toolCalls: Array<{ name: string; args: unknown }>;
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
    .select({ callIndex: llmCalls.callIndex, request: llmCalls.request, response: llmCalls.response })
    .from(llmCalls)
    .where(eq(llmCalls.runId, runId))
    .orderBy(llmCalls.callIndex)) as Array<{ callIndex: number; request: unknown; response: unknown }>;

  let requestContext = '';
  const toolCalls: Array<{ name: string; args: unknown }> = [];
  for (const row of rows) {
    const messages = (row.request as { messages?: Array<{ role: string; content?: unknown }> } | null)?.messages ?? [];
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser !== undefined && typeof lastUser.content === 'string' && lastUser.content.trim() !== '') {
      requestContext = lastUser.content;
    }
    const calls = (row.response as { toolCalls?: Array<{ name?: unknown; args?: unknown }> | null } | null)?.toolCalls ?? [];
    for (const call of calls) {
      toolCalls.push({ name: String(call.name ?? '?'), args: call.args ?? {} });
    }
  }
  return { requestContext, toolCalls };
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
