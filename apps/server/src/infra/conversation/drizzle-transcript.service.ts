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
}

/**
 * Pure projection of run messages to turn rows (D-K, ADR-0013 §8). `role` is
 * derived so a P3 rollback — which reads history as `role IN ('user','assistant')`
 * and context as the latest `role='summary'` row — sees only real user/assistant
 * text, never tool plumbing.
 */
export function toTurnRows(input: AppendRunMessagesInput): TurnRow[] {
  const rows: TurnRow[] = [];
  for (const message of input.messages) {
    if (message.kind === 'human') {
      rows.push({
        userId: input.userId,
        phase: input.phase,
        runId: input.runId,
        kind: 'human',
        role: 'user',
        content: message.text,
        payload: null,
      });
    } else if (message.kind === 'ai') {
      rows.push({
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
        rows.push({
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
      rows.push({
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

/** TranscriptPort adapter — appends only; no reads (INV-LLM-001). */
export class DrizzleTranscriptService implements TranscriptPort {
  async appendRunMessages(input: AppendRunMessagesInput): Promise<void> {
    const rows = toTurnRows(input);
    if (rows.length === 0) {
      return;
    }
    const { db } = await import('@infra/db/drizzle');
    const { conversationTurns } = await import('@infra/db/schema');
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
