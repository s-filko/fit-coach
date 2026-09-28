/**
 * INV-LLM-010 / BUG-029. The order a run's rows were produced in is recoverable from the database via a
 * per-run monotonic `seq`, written by `toTurnRows`/`appendRunMessages`. Before this, the table stored
 * no order at all — one INSERT per run gave every row the same `created_at` (DEFAULT now()), and
 * `evals/lib/export-query.ts`'s `ORDER BY created_at` tied rows however the engine happened to see
 * them. Live evidence of the original loss: all 14 rows of run 2ec8c9b2 shared created_at
 * 2026-09-21 09:29:41.007256.
 *
 * Why a plain read-back would not have failed on the original bug: on a freshly written table
 * Postgres returns tied rows in physical (insertion) order, so the correct-looking result was an
 * accident of layout, not a guarantee — a plain UPDATE, VACUUM FULL, a dump/restore or replication
 * all change physical order. This test removes that luck: after the run is written through the real
 * append path, every row is rewritten with an ordinary UPDATE of a harmless column, in REVERSE
 * produced order, and the real reader (`fetchRunsSince`) must still return the produced order.
 *
 * The run is written through the SAME two calls production now makes (INV-LLM-009, Task 1): the adapter
 * pre-persists the human message before `graph.invoke`, then commit projects the whole run, its own
 * human row deduped away — `seq` has to stay monotonic across both, not restart at 1 in each call.
 */
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { DrizzleConversationRunService } from '@infra/conversation/drizzle-conversation-run.service';
import { DrizzleTranscriptService, toTurnRows } from '@infra/conversation/drizzle-transcript.service';
import { db } from '@infra/db/drizzle';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { conversationRuns, conversationTurns } from '@infra/db/schema';

import { fetchRunsSince } from '../../../evals/lib/export-query';
import { createTestUserData } from '../../shared/test-factories';
import { BASE_CONVERSATION_RUN_RECORD } from './conversation-run-record.fixture';

/** A run shaped like the live ones: user message, tool round-trips, final reply. Every row is distinguishable. */
const messages = [
  { kind: 'human' as const, text: 'step-01 user message' },
  {
    kind: 'ai' as const,
    text: '',
    toolCalls: [
      { id: 'c1', name: 'tool_a', args: {} },
      { id: 'c2', name: 'tool_b', args: {} },
    ],
  },
  { kind: 'tool_result' as const, toolCallId: 'c1', text: 'step-05 result of a', status: 'ok' as const },
  { kind: 'tool_result' as const, toolCallId: 'c2', text: 'step-06 result of b', status: 'ok' as const },
  { kind: 'ai' as const, text: 'step-07 ai text', toolCalls: [{ id: 'c3', name: 'tool_c', args: {} }] },
  { kind: 'tool_result' as const, toolCallId: 'c3', text: 'step-09 result of c', status: 'ok' as const },
  { kind: 'ai' as const, text: 'step-10 final reply' },
];

const label = (row: { kind: string; content: string }): string => `${row.kind}:${row.content}`;

describe('order of the rows of one run is recoverable from the database (BUG-029)', () => {
  let runId: string;
  let produced: string[];

  beforeAll(async () => {
    const user = await new DrizzleUserRepository().create(createTestUserData({ username: `ord_repro_${Date.now()}` }));
    runId = randomUUID();
    const input = { userId: user.id, runId, phase: 'training' as const, episodeId: runId, messages };
    produced = toTurnRows(input).map(label);

    // INV-LLM-009's split (Task 1): the adapter pre-persists the human message in
    // its own call, before graph.invoke; commit later projects the WHOLE
    // run's messages, its own human row deduped away by drizzle-transcript's
    // appendRunMessages. Write it exactly that way — two calls, not one — or
    // a call-scoped seq would give both calls' first row seq 1 and this probe
    // could go green by the same luck it exists to remove.
    await new DrizzleTranscriptService().appendRunMessages({ ...input, messages: [messages[0]!] });
    await new DrizzleTranscriptService().appendRunMessages(input);
    await new DrizzleConversationRunService().recordRun({
      ...BASE_CONVERSATION_RUN_RECORD,
      runId,
      userId: user.id,
      phaseIn: 'training',
      model: 'test-model',
      tokensIn: 1,
      tokensOut: 1,
      latencyMs: 10,
      outcome: 'ok',
    });
  });

  // `orderBy(ctid)` is deliberate (as-users-grow hardening, 2026-09-22): this plan adds
  // idx_conversation_turns_run_id, so an equality filter on run_id can now be served by a Bitmap
  // Heap Scan instead of a Seq Scan, and the whole point of this test is to read PHYSICAL
  // (heap/page) order deliberately — not whatever order a scan happens to hand back. Which scan
  // Postgres picks is a planner choice, not a guarantee, so an unordered `SELECT` can no longer be
  // trusted to reflect tuple layout. `ctid` is Postgres's physical tuple location, so ordering by it
  // asks for heap order directly instead of hoping a scan strategy produces it. Fixture soundness 1
  // below proves the rewrite loop actually moved the tuples: it only holds if `rowsOfRun()` is truly
  // reading physical order.
  const rowsOfRun = () => db.select().from(conversationTurns).where(eq(conversationTurns.runId, runId)).orderBy(sql`ctid`);

  const readByReader = async (): Promise<string[]> => {
    const run = (await fetchRunsSince(new Date(0), 50)).find(r => r.runId === runId);
    return (run?.turns ?? []).map(label);
  };

  it('INV-LLM-010: seq is monotonic 1..n across the two calls that write a run today, in produced order', async () => {
    const bySeq = [...(await rowsOfRun())].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    expect(bySeq.map(r => r.seq)).toEqual(produced.map((_, i) => i + 1));
    expect(bySeq.map(label)).toEqual(produced);
  });

  it('after an ordinary rewrite of the rows the reader still returns the produced order', async () => {
    // Rewrite every row in REVERSE produced order: each UPDATE writes a new tuple version, so the
    // physical order of the run's rows becomes the reverse of the produced order.
    const byLabel = new Map((await rowsOfRun()).map(r => [label(r), r.id]));
    for (const l of [...produced].reverse()) {
      await db
        .update(conversationTurns)
        .set({ content: sql`${conversationTurns.content}` })
        .where(eq(conversationTurns.id, byLabel.get(l)!));
    }

    // Fixture soundness 1: the rewrite really moved the rows — an unordered read is no longer in produced order.
    expect((await rowsOfRun()).map(label)).not.toEqual(produced);
    // Fixture soundness 2: nothing was lost or changed — ordered by the produced position the test
    // itself stored, the rows are exactly the produced sequence.
    const position = new Map(produced.map((l, i) => [l, i]));
    expect((await rowsOfRun()).map(label).sort((a, b) => position.get(a)! - position.get(b)!)).toEqual(produced);

    // The probe: the reader's order is the produced order.
    expect(await readByReader()).toEqual(produced);
  });
});

/**
 * INV-LLM-010, the cross-run half: `fetchRunsSince`'s turns query spans every run since the cutoff
 * and is capped by `limit * 4`, THEN bucketed per run — it is not a single-run read. Ordering that
 * shared pool by `seq` first (nulls last in ASC) sorts every pre-migration row — no `seq` at all —
 * behind every seq'd row, so a truncating LIMIT drops old, seq-less runs before it touches any newer
 * one: exactly backwards from "oldest first, whole runs." `createdAt` has to lead; `seq` is only the
 * tiebreak within a tied timestamp. The single-run test above cannot see this — it never lets the
 * LIMIT bite across more than one run.
 */
describe('fetchRunsSince orders whole runs oldest-first, not by a shared-pool seq tiebreak (INV-LLM-010)', () => {
  const SINCE = new Date('2099-06-01T00:00:00.000Z');
  const at = (offsetMs: number): Date => new Date(SINCE.getTime() + offsetMs);

  let historicalRunId: string;
  let runAId: string;
  let runBId: string;

  beforeAll(async () => {
    const user = await new DrizzleUserRepository().create(createTestUserData({ username: `ord_limit_${Date.now()}` }));

    const baseRun = {
      ...BASE_CONVERSATION_RUN_RECORD,
      userId: user.id,
      phaseIn: 'chat' as const,
      model: null,
      tokensIn: null,
      tokensOut: null,
      latencyMs: 10,
      outcome: 'ok' as const,
    };
    const baseTurn = { userId: user.id, phase: 'chat' as const, kind: 'human' as const, role: 'user' as const };

    // The historical run: OLDEST, and — like every pre-migration row — its turns carry no seq at all.
    historicalRunId = randomUUID();
    await db.insert(conversationRuns).values({ ...baseRun, runId: historicalRunId, createdAt: at(0) });
    await db.insert(conversationTurns).values(
      ['h-1', 'h-2', 'h-3'].map((content, i) => ({
        ...baseTurn,
        runId: historicalRunId,
        content,
        seq: null,
        createdAt: at(i * 1000),
      })),
    );

    // Two newer runs, each fully seq'd (as every run is today) — 5 turns each, same timestamp per
    // run so their own order depends entirely on seq, the way a real run's commit-node INSERT would.
    runAId = randomUUID();
    await db.insert(conversationRuns).values({ ...baseRun, runId: runAId, createdAt: at(60_000) });
    await db.insert(conversationTurns).values(
      ['a-1', 'a-2', 'a-3', 'a-4', 'a-5'].map((content, i) => ({
        ...baseTurn,
        runId: runAId,
        content,
        seq: i + 1,
        createdAt: at(60_000),
      })),
    );

    runBId = randomUUID();
    await db.insert(conversationRuns).values({ ...baseRun, runId: runBId, createdAt: at(120_000) });
    await db.insert(conversationTurns).values(
      ['b-1', 'b-2', 'b-3', 'b-4', 'b-5'].map((content, i) => ({
        ...baseTurn,
        runId: runBId,
        content,
        seq: i + 1,
        createdAt: at(120_000),
      })),
    );
  });

  // 3 runs, 13 turns total — `fetchRunsSince(SINCE, 3)`'s turns query caps at 3*4=12, one short, so
  // the LIMIT must decide which run's tail it cuts. Oldest-first means the newest run (B) loses a
  // row, never the historical one.
  it('keeps the historical (seq-less) run whole and orders runs oldest-first when the LIMIT bites', async () => {
    const result = await fetchRunsSince(SINCE, 3);

    expect(result.map(r => r.runId)).toEqual([historicalRunId, runAId, runBId]);

    const historical = result.find(r => r.runId === historicalRunId)!;
    expect(historical.turns.map(t => t.content)).toEqual(['h-1', 'h-2', 'h-3']);

    const runA = result.find(r => r.runId === runAId)!;
    expect(runA.turns.map(t => t.content)).toEqual(['a-1', 'a-2', 'a-3', 'a-4', 'a-5']);
  });
});
