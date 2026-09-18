import { eq } from 'drizzle-orm';

import { db } from '../../../src/infra/db/drizzle';
import { conversationSummaries, conversationTurns } from '../../../src/infra/db/schema';
import { DrizzleSummaryService } from '../../../src/infra/conversation/drizzle-summary.service';
import { DrizzleTranscriptService } from '../../../src/infra/conversation/drizzle-transcript.service';
import { DrizzleUserRepository } from '../../../src/infra/db/repositories/user.repository';
import { createTestUserData } from '../../shared/test-factories';

/**
 * Transcript + summary DB round-trips (refactor-p4-episode-memory Task 3).
 * Runs under RUN_DB_TESTS=1 against the local compose DB (npm run test:integration).
 */
describe('DrizzleTranscriptService / DrizzleSummaryService – integration', () => {
  let userId: string;
  const transcript = new DrizzleTranscriptService();
  const summaries = new DrizzleSummaryService();

  beforeAll(async () => {
    const user = await new DrizzleUserRepository().create(createTestUserData({ username: `p4_transcript_${Date.now()}` }));
    userId = user.id;
  });

  afterAll(async () => {
    await db.delete(conversationSummaries).where(eq(conversationSummaries.userId, userId));
    await db.delete(conversationTurns).where(eq(conversationTurns.userId, userId));
  });

  it('appendRunMessages writes one row per message plus one per tool call (D-K, BUG-016: run_id set)', async () => {
    const runId = '11111111-1111-4111-8111-111111111110';
    await transcript.appendRunMessages({
      userId,
      runId,
      phase: 'plan_creation',
      episodeId: '11111111-1111-4111-8111-111111111111',
      messages: [
        { kind: 'human', text: 'составь план' },
        { kind: 'ai', text: '', toolCalls: [{ id: 'call-1', name: 'search_exercises', args: { query: 'chest' } }] },
        { kind: 'tool_result', toolCallId: 'call-1', text: 'Found 1 exercises:', status: 'ok' },
        { kind: 'ai', text: 'Предлагаю жим лёжа' },
      ],
    });

    const rows = await db.select().from(conversationTurns).where(eq(conversationTurns.runId, runId));
    expect(rows.map(r => r.kind)).toEqual(['human', 'ai', 'tool_call', 'tool_result', 'ai']);
    expect(rows.every(r => r.runId === runId)).toBe(true);
    const roles = new Map(rows.map(r => [r.kind, r.role]));
    expect(roles.get('human')).toBe('user');
    expect(roles.get('tool_call')).toBe('system');
    expect(roles.get('tool_result')).toBe('system');
    // The textless AI message (tool-call carrier) derives role system, the
    // closing text message derives assistant (D-K).
    expect(rows.filter(r => r.kind === 'ai').map(r => r.role)).toEqual(['system', 'assistant']);
  });

  it('appendSystemNote writes a system_note row without a run id', async () => {
    await transcript.appendSystemNote({ userId, phase: 'chat', text: 'Context cleared' });
    const rows = await db.select().from(conversationTurns).where(eq(conversationTurns.userId, userId));
    const note = rows.find(r => r.kind === 'system_note');
    expect(note).toMatchObject({ role: 'system', content: 'Context cleared' });
    expect(note?.runId).toBeNull();
  });

  it('insert writes the conversation_summaries row and mirrors it to a summary turn row in one transaction', async () => {
    const structured = { topics: ['plan'], decisions: [], userState: [], trainingFeedback: [], openItems: [] };
    await summaries.insert({
      userId,
      runId: '11111111-1111-4111-8111-111111111110',
      episodeId: '11111111-1111-4111-8111-111111111111',
      phaseAtEnd: 'plan_creation',
      structured,
      rendered: 'plan_creation (today): plan discussed',
    });

    const [summaryRow] = await db.select().from(conversationSummaries).where(eq(conversationSummaries.userId, userId));
    expect(summaryRow).toMatchObject({ episodeId: '11111111-1111-4111-8111-111111111111', phaseAtEnd: 'plan_creation' });
    expect(summaryRow?.structured).toEqual(structured);
    expect(summaryRow?.rendered).toBe('plan_creation (today): plan discussed');

    const turnRows = await db.select().from(conversationTurns).where(eq(conversationTurns.userId, userId));
    const mirrored = turnRows.filter(r => r.kind === 'summary');
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]).toMatchObject({ role: 'summary', content: 'plan_creation (today): plan discussed', payload: structured });
  });

  it('latestLegacySummary returns the newest summary turn row (D-E import source)', async () => {
    const legacy = await summaries.latestLegacySummary(userId);
    expect(legacy).toMatchObject({ text: 'plan_creation (today): plan discussed', phase: 'plan_creation' });
    expect(legacy?.createdAt).toBeInstanceOf(Date);
  });

  it('latestLegacySummary returns null for a user without summaries', async () => {
    const other = await new DrizzleUserRepository().create(createTestUserData({ username: `p4_nosum_${Date.now()}` }));
    await expect(summaries.latestLegacySummary(other.id)).resolves.toBeNull();
    await db.delete(conversationTurns).where(eq(conversationTurns.userId, other.id));
  });
});
