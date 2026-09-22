/**
 * AC-AT-4 / BUG-029. The order a run's rows were produced in is recoverable from the database via a
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
 * The run is written through the SAME two calls production now makes (AC-AT-1, Task 1): the adapter
 * pre-persists the human message before `graph.invoke`, then commit projects the whole run, its own
 * human row deduped away — `seq` has to stay monotonic across both, not restart at 1 in each call.
 */
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';

import { DrizzleConversationRunService } from '@infra/conversation/drizzle-conversation-run.service';
import { DrizzleTranscriptService, toTurnRows } from '@infra/conversation/drizzle-transcript.service';
import { db } from '@infra/db/drizzle';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { conversationTurns } from '@infra/db/schema';

import { fetchRunsSince } from '../../../evals/lib/export-query';
import { createTestUserData } from '../../shared/test-factories';

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

    // AC-AT-1's split (Task 1): the adapter pre-persists the human message in
    // its own call, before graph.invoke; commit later projects the WHOLE
    // run's messages, its own human row deduped away by drizzle-transcript's
    // appendRunMessages. Write it exactly that way — two calls, not one — or
    // a call-scoped seq would give both calls' first row seq 1 and this probe
    // could go green by the same luck it exists to remove.
    await new DrizzleTranscriptService().appendRunMessages({ ...input, messages: [messages[0]!] });
    await new DrizzleTranscriptService().appendRunMessages(input);
    await new DrizzleConversationRunService().recordRun({
      runId,
      userId: user.id,
      phaseIn: 'training',
      phaseOut: null,
      trigger: 'user_message',
      client: 'telegram',
      model: 'test-model',
      promptVersions: {},
      tokensIn: 1,
      tokensOut: 1,
      latencyMs: 10,
      toolCalls: null,
      transition: null,
      outcome: 'ok',
      budgetReport: null,
    });
  });

  const rowsOfRun = () => db.select().from(conversationTurns).where(eq(conversationTurns.runId, runId));

  const readByReader = async (): Promise<string[]> => {
    const run = (await fetchRunsSince(new Date(0), 50)).find(r => r.runId === runId);
    return (run?.turns ?? []).map(label);
  };

  it('AC-AT-4: seq is monotonic 1..n across the two calls that write a run today, in produced order', async () => {
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
