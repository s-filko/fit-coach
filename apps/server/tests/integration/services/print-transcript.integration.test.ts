/**
 * AC-AT-5: `print-transcript`'s reader (real DB) + formatter, asserted on the produced OUTPUT, not
 * internal state — this is a printing tool, its contract is what a person reads. Per the Task
 * 3/4/5 lesson (a global operation needs a global test): seeds SEVERAL distinct runs — a normal one
 * with a tool round trip, a failed one, one with already-pruned payloads, and a pre-migration run
 * with NULL seq — plus a second user and an out-of-window run, to prove the selectors scope
 * correctly rather than just "return something".
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { recordLlmCall } from '@infra/ai/llm-call-recorder';
import { DrizzleConversationRunService } from '@infra/conversation/drizzle-conversation-run.service';
import { DrizzleTranscriptService } from '@infra/conversation/drizzle-transcript.service';
import { db } from '@infra/db/drizzle';
import { conversationRuns, conversationTurns, llmCalls, promptBlobs, workoutSessions } from '@infra/db/schema';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';

import { formatTranscripts } from '@infra/observability/transcript-formatter';
import {
  fetchRunsForUserWindow,
  fetchRunTranscript,
  resolvePromptBlobs,
  resolveSessionWindow,
} from '@infra/observability/transcript-reader';

import { createTestUserData } from '../../shared/test-factories';

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedUser(tag: string) {
  return new DrizzleUserRepository().create(createTestUserData({ username: `print_transcript_${tag}_${Date.now()}` }));
}

/** A normal completed run: pre-persisted human message (AC-AT-1), a tool round trip, two llm_calls, a run row. */
async function seedNormalRun(userId: string): Promise<string> {
  const runId = randomUUID();
  const transcript = new DrizzleTranscriptService();
  await transcript.appendRunMessages({
    userId,
    runId,
    phase: 'training',
    episodeId: runId,
    messages: [{ kind: 'human', text: 'следующий подход' }],
  });

  await recordLlmCall({
    runId,
    model: 'z-ai/glm-5.3',
    request: {
      model: 'z-ai/glm-5.3',
      messages: [
        { role: 'system', content: 'RULES: only discuss fitness.' },
        { role: 'user', content: 'следующий подход' },
      ],
      temperature: 0.7,
    },
    response: {
      text: '',
      toolCalls: [{ id: 'c1', name: 'log_set', args: { reps: 8 } }],
      finishReason: 'tool_calls',
      usage: { promptTokens: 100, completionTokens: 10 },
    },
    latencyMs: 400,
  });

  await transcript.appendRunMessages({
    userId,
    runId,
    phase: 'training',
    episodeId: runId,
    messages: [
      { kind: 'human', text: 'следующий подход' },
      { kind: 'ai', text: '', toolCalls: [{ id: 'c1', name: 'log_set', args: { reps: 8 } }] },
      { kind: 'tool_result', toolCallId: 'c1', text: 'Записано.', status: 'ok' },
      { kind: 'ai', text: 'Готово! Что дальше?' },
    ],
  });

  await new DrizzleConversationRunService().recordRun({
    runId,
    userId,
    phaseIn: 'training',
    phaseOut: null,
    trigger: 'user_message',
    client: 'telegram',
    model: 'z-ai/glm-5.3',
    promptVersions: {},
    tokensIn: 100,
    tokensOut: 10,
    latencyMs: 600,
    toolCalls: null,
    transition: null,
    outcome: 'ok',
    budgetReport: null,
  });

  return runId;
}

/** AC-AT-1/AC-AT-2 shape: the human message survives, the model call never answers, the run records why. */
async function seedFailedRun(userId: string): Promise<string> {
  const runId = randomUUID();
  await new DrizzleTranscriptService().appendRunMessages({
    userId,
    runId,
    phase: 'training',
    episodeId: runId,
    messages: [{ kind: 'human', text: 'накинул 10кг и сделал еще подход на 12' }],
  });
  await new DrizzleConversationRunService().recordRun({
    runId,
    userId,
    phaseIn: 'training',
    phaseOut: null,
    trigger: 'user_message',
    client: 'telegram',
    model: null,
    promptVersions: {},
    tokensIn: null,
    tokensOut: null,
    latencyMs: 50,
    toolCalls: null,
    transition: null,
    outcome: 'core_error',
    budgetReport: null,
    errorClass: 'CoreError',
    errorMessage: 'model call threw',
  });
  return runId;
}

/** AC-AT-6 already-pruned state, seeded directly (not via the prune) — one call whose whole request/response was dropped, one whose request survives but references an already-pruned blob. */
async function seedRunWithPrunedPayloads(userId: string): Promise<string> {
  const runId = randomUUID();
  const prunedHash = 'p'.repeat(64);
  await db.insert(promptBlobs).values({ hash: prunedHash, content: null }).onConflictDoNothing();

  await db.insert(llmCalls).values([
    {
      runId,
      callIndex: 1,
      model: 'z-ai/glm-5.3',
      request: null,
      response: null,
      promptHashes: [],
      latencyMs: 300,
    },
    {
      runId,
      callIndex: 2,
      model: 'z-ai/glm-5.3',
      request: { model: 'z-ai/glm-5.3', messages: [{ role: 'system', contentHash: prunedHash }] },
      response: { text: 'ok', finishReason: 'stop', usage: null },
      promptHashes: [prunedHash],
      latencyMs: 300,
    },
  ]);

  await new DrizzleConversationRunService().recordRun({
    runId,
    userId,
    phaseIn: 'training',
    phaseOut: null,
    trigger: 'user_message',
    client: 'telegram',
    model: 'z-ai/glm-5.3',
    promptVersions: {},
    tokensIn: 10,
    tokensOut: 5,
    latencyMs: 600,
    toolCalls: null,
    transition: null,
    outcome: 'ok',
    budgetReport: null,
  });
  return runId;
}

/** A pre-AC-AT-4 row, written directly with seq NULL — no toTurnRows, no recordLlmCall, matching a row from before the migration. */
async function seedPreMigrationRun(userId: string): Promise<string> {
  const runId = randomUUID();
  await db.insert(conversationTurns).values([
    { userId, phase: 'chat', role: 'user', content: 'legacy сообщение', runId, kind: 'human', seq: null },
    { userId, phase: 'chat', role: 'assistant', content: 'legacy ответ', runId, kind: 'ai', seq: null },
  ]);
  await new DrizzleConversationRunService().recordRun({
    runId,
    userId,
    phaseIn: 'chat',
    phaseOut: null,
    trigger: 'user_message',
    client: 'telegram',
    model: 'z-ai/glm-5.3',
    promptVersions: {},
    tokensIn: 10,
    tokensOut: 5,
    latencyMs: 200,
    toolCalls: null,
    transition: null,
    outcome: 'ok',
    budgetReport: null,
  });
  return runId;
}

async function transcriptFor(runId: string, includePayloads = false): Promise<string> {
  const rt = await fetchRunTranscript(runId);
  const blobs = includePayloads ? await resolvePromptBlobs(rt.llmCalls) : new Map<string, string | null>();
  return formatTranscripts([rt], blobs, { includePayloads });
}

describe('print-transcript (AC-AT-5)', () => {
  it('a normal run with a tool round trip prints human, tool call/result and answer in order', async () => {
    const user = await seedUser('normal');
    const runId = await seedNormalRun(user.id);

    const out = await transcriptFor(runId);

    expect(out).toContain('outcome: ok');
    expect(out).toContain('HUMAN: следующий подход');
    expect(out).toContain('TOOL_CALL log_set({"reps":8})');
    expect(out).toContain('TOOL_RESULT [ok] Записано.');
    expect(out).toContain('AI: Готово! Что дальше?');
    expect(out).not.toContain('NO ANSWER');
    const order = ['HUMAN:', 'TOOL_CALL', 'TOOL_RESULT', 'Готово'].map(s => out.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('a failed run prints as failed, with the error, and the missing answer is visibly flagged (BUG-022)', async () => {
    const user = await seedUser('failed');
    const runId = await seedFailedRun(user.id);

    const out = await transcriptFor(runId);

    expect(out).toContain('RUN FAILED: core_error — CoreError: model call threw');
    expect(out).toContain('HUMAN: накинул 10кг и сделал еще подход на 12');
    expect(out).toContain('NO ANSWER RECORDED');
    expect(out).toContain('BUG-022');
  });

  it('AC-AT-6: a run with pruned payloads prints "aged out" for both a fully pruned call and a pruned blob reference — never empty or a crash', async () => {
    const user = await seedUser('pruned');
    const runId = await seedRunWithPrunedPayloads(user.id);

    const out = await transcriptFor(runId, true);

    expect(out).toContain('request: [aged out — retention pruned this payload]');
    expect(out).toMatch(/payload aged out — retention pruned this prompt, hash p{10,}/);
    expect(out).toContain('response: "ok" finishReason=stop');
  });

  it('AC-AT-4: a pre-migration run with NULL seq is warned about, not dropped or silently reordered', async () => {
    const user = await seedUser('legacy');
    const runId = await seedPreMigrationRun(user.id);

    const out = await transcriptFor(runId);

    expect(out).toContain('predate AC-AT-4');
    expect(out).toContain('legacy сообщение');
    expect(out).toContain('legacy ответ');
    expect(out).toContain('seq —');
  });

  it('a run with no llm_calls or conversation_turns rows still prints, not crashing', async () => {
    const runId = randomUUID();
    const out = await transcriptFor(runId);
    expect(out).toContain(`=== RUN ${runId} ===`);
    expect(out).toContain('no conversation_runs row');
  });

  describe('multi-run selectors — scoping across several runs, not one', () => {
    it('fetchRunsForUserWindow returns only this user’s runs inside the window, oldest first, excluding a run just outside it and a same-time run for a different user', async () => {
      const user = await seedUser('windowed');
      const other = await seedUser('other');
      const since = new Date('2026-09-21T00:00:00.000Z');
      const until = new Date('2026-09-21T23:59:59.000Z');

      const inWindowRun1 = await seedFailedRun(user.id); // createdAt defaults to now() — override below
      const inWindowRun2 = await seedNormalRun(user.id);
      const outsideRun = await seedNormalRun(user.id);
      const otherUserRun = await seedNormalRun(other.id);

      // Pin created_at explicitly: two of this user's runs inside the window (in produced order),
      // one for the same user just outside it, one inside the window but for a DIFFERENT user.
      await db
        .update(conversationRuns)
        .set({ createdAt: new Date('2026-09-21T08:00:00.000Z') })
        .where(eq(conversationRuns.runId, inWindowRun1));
      await db
        .update(conversationRuns)
        .set({ createdAt: new Date('2026-09-21T09:00:00.000Z') })
        .where(eq(conversationRuns.runId, inWindowRun2));
      await db
        .update(conversationRuns)
        .set({ createdAt: new Date('2026-09-22T00:00:01.000Z') }) // just past `until`
        .where(eq(conversationRuns.runId, outsideRun));
      await db
        .update(conversationRuns)
        .set({ createdAt: new Date('2026-09-21T10:00:00.000Z') })
        .where(eq(conversationRuns.runId, otherUserRun));

      const runs = await fetchRunsForUserWindow(user.id, since, until);

      expect(runs.map(r => r.runId)).toEqual([inWindowRun1, inWindowRun2]);
    });

    it('resolveSessionWindow resolves a workout session to its user and time span, then that span finds the run inside it', async () => {
      const user = await seedUser('session');
      const runId = await seedNormalRun(user.id);
      await db
        .update(conversationRuns)
        .set({ createdAt: new Date('2026-09-21T12:30:00.000Z') })
        .where(eq(conversationRuns.runId, runId));

      const [session] = await db
        .insert(workoutSessions)
        .values({
          userId: user.id,
          status: 'completed',
          startedAt: new Date('2026-09-21T12:00:00.000Z'),
          completedAt: new Date('2026-09-21T13:00:00.000Z'),
        })
        .returning();

      const window = await resolveSessionWindow(session!.id);
      expect(window).toEqual({
        userId: user.id,
        since: new Date('2026-09-21T12:00:00.000Z'),
        until: new Date('2026-09-21T13:00:00.000Z'),
      });

      const runs = await fetchRunsForUserWindow(window!.userId, window!.since, window!.until);
      expect(runs.map(r => r.runId)).toEqual([runId]);
    });

    it('resolveSessionWindow returns null for a session id that does not exist', async () => {
      await expect(resolveSessionWindow(randomUUID())).resolves.toBeNull();
    });

    it('close-out R2 finding 8: fetchRunsForUserWindow also finds a run whose conversation_runs row was never written, interleaved in order with rows that were', async () => {
      const user = await seedUser('orphan');
      const since = new Date('2026-09-21T00:00:00.000Z');
      const until = new Date('2026-09-21T23:59:59.000Z');

      // A normal run, pinned to the middle of the window.
      const normalRunId = await seedNormalRun(user.id);
      await db
        .update(conversationRuns)
        .set({ createdAt: new Date('2026-09-21T12:00:00.000Z') })
        .where(eq(conversationRuns.runId, normalRunId));

      // AC-AT-1's preservation case: the inbound message was persisted (transcript.appendRunMessages,
      // before the graph ran), but the process was killed before commit.node.ts's recordRun — no
      // conversation_runs row ever exists for this run_id. Pinned earlier in the window than the
      // normal run, to prove ordering interleaves them rather than always sorting orphans last.
      const orphanRunId = randomUUID();
      await new DrizzleTranscriptService().appendRunMessages({
        userId: user.id,
        runId: orphanRunId,
        phase: 'training',
        episodeId: orphanRunId,
        messages: [{ kind: 'human', text: 'оборвалось на середине' }],
      });
      await db
        .update(conversationTurns)
        .set({ createdAt: new Date('2026-09-21T08:00:00.000Z') })
        .where(eq(conversationTurns.runId, orphanRunId));

      const runs = await fetchRunsForUserWindow(user.id, since, until);

      expect(runs.map(r => r.runId)).toEqual([orphanRunId, normalRunId]);
      const orphan = runs.find(r => r.runId === orphanRunId)!;
      expect(orphan.run).toBeNull();
      expect(orphan.turns.map(t => t.content)).toEqual(['оборвалось на середине']);
    });
  });
});
