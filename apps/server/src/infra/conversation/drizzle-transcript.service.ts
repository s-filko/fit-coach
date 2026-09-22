import type { AppendRunMessagesInput, TranscriptMessage, TranscriptPort } from '@domain/conversation/ports';

/** The turn-row value shape (drizzle insert values for `conversation_turns`). */
export interface TurnRow {
  userId: string;
  phase: AppendRunMessagesInput['phase'];
  runId: string;
  kind: 'human' | 'ai' | 'tool_call' | 'tool_result' | 'system_note' | 'summary';
  role: 'user' | 'assistant' | 'system' | 'summary';
  content: string;
  payload: Record<string, unknown> | null;
  /** AC-AT-4: this row's position in the run, closes BUG-029. */
  seq: number;
}

/**
 * Pure projection of run messages to turn rows (D-K, ADR-0013 §8). `role` is
 * derived so a P3 rollback — which reads history as `role IN ('user','assistant')`
 * and context as the latest `role='summary'` row — sees only real user/assistant
 * text, never tool plumbing.
 *
 * `startSeq` (AC-AT-4, default 1) numbers the OUTPUT rows `startSeq..startSeq+n-1`
 * in message order. It exists because a run's messages reach the table through
 * TWO `appendRunMessages` calls (AC-AT-1: the adapter pre-persists the human
 * message before `graph.invoke`, commit projects the rest) — each call to this
 * function only ever sees its own slice, so numbering has to be seeded from
 * outside, by whatever `seq` the run already has in the database, or every
 * call would restart at 1 and the order would still be unrecoverable across
 * the two inserts. `appendRunMessages` below is what resolves that seed.
 */
export function toTurnRows(input: AppendRunMessagesInput, startSeq = 1): TurnRow[] {
  const rows: TurnRow[] = [];
  let seq = startSeq;
  const push = (row: Omit<TurnRow, 'seq'>): void => {
    rows.push({ ...row, seq });
    seq += 1;
  };
  for (const message of input.messages) {
    if (message.kind === 'human') {
      push({
        userId: input.userId,
        phase: input.phase,
        runId: input.runId,
        kind: 'human',
        role: 'user',
        content: message.text,
        payload: null,
      });
    } else if (message.kind === 'ai') {
      push({
        userId: input.userId,
        phase: input.phase,
        runId: input.runId,
        kind: 'ai',
        role: message.text.length > 0 ? 'assistant' : 'system',
        content: message.text,
        payload:
          message.toolCalls !== undefined && message.toolCalls.length > 0 ? { tool_calls: message.toolCalls } : null,
      });
      for (const call of message.toolCalls ?? []) {
        push({
          userId: input.userId,
          phase: input.phase,
          runId: input.runId,
          kind: 'tool_call',
          role: 'system',
          content: call.name,
          payload: { tool_call_id: call.id, args: call.args },
        });
      }
    } else {
      push({
        userId: input.userId,
        phase: input.phase,
        runId: input.runId,
        kind: 'tool_result',
        role: 'system',
        content: message.text,
        payload: { tool_call_id: message.toolCallId, status: message.status },
      });
    }
  }
  return rows;
}

/**
 * TranscriptPort adapter — appends only; its one read is the AC-AT-1 dedup
 * below, not a domain read (INV-LLM-001 is about the prompt, not this).
 */
export class DrizzleTranscriptService implements TranscriptPort {
  async appendRunMessages(input: AppendRunMessagesInput): Promise<void> {
    if (input.messages.length === 0) {
      return;
    }
    const { db } = await import('@infra/db/drizzle');
    const { conversationTurns } = await import('@infra/db/schema');
    const { and, eq } = await import('drizzle-orm');
    const { nextSeqForRun } = await import('./seq');

    let { messages } = input;
    if (messages.some(m => m.kind === 'human')) {
      // AC-AT-1: the adapter persists the run's human message before
      // graph.invoke, keyed by run_id. When commit later projects the same
      // run's messages, its own human message is the one already there —
      // drop it before numbering so it is never written twice and never
      // wastes a seq slot.
      const [existing] = await db
        .select({ id: conversationTurns.id })
        .from(conversationTurns)
        .where(and(eq(conversationTurns.runId, input.runId), eq(conversationTurns.kind, 'human')))
        .limit(1);
      if (existing) {
        messages = messages.filter(m => m.kind !== 'human');
      }
    }
    if (messages.length === 0) {
      return;
    }

    // AC-AT-4: this run's messages arrive through up to two calls (the
    // pre-persisted human message, then commit's projection of the rest) —
    // continue numbering from whatever this run_id already has, so seq stays
    // monotonic across both inserts instead of restarting at 1 each call.
    const startSeq = await nextSeqForRun(db, input.runId);

    const rows = toTurnRows({ ...input, messages }, startSeq);
    await db.insert(conversationTurns).values(rows);
  }

  async appendSystemNote(input: {
    userId: string;
    phase: AppendRunMessagesInput['phase'];
    text: string;
  }): Promise<void> {
    const { db } = await import('@infra/db/drizzle');
    const { conversationTurns } = await import('@infra/db/schema');
    await db.insert(conversationTurns).values({
      userId: input.userId,
      phase: input.phase,
      role: 'system',
      content: input.text,
      runId: null,
      kind: 'system_note',
      payload: null,
    });
  }
}

export type { TranscriptMessage };
