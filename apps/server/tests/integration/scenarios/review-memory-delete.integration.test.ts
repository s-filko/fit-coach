/**
 * What deleting a fact guarantees — and what it does not (AC-RRP-6, rescoped 2026-09-21).
 *
 * The owner's decision (ADR-0009, 2026-09-21): NOTHING IS EVER ERASED. `manage_fact delete` archives the
 * row as `user_deleted`, the user is told it is deleted, and the guarantee is not erasure from storage
 * but that it NEVER SURFACES AGAIN. A real erasure (a legal demand, someone else's data) is a separate,
 * unbuilt capability. So this file proves the guarantee as it stands, through the real paths (real graph,
 * real repositories, real test DB, only the model scripted), and pins the honest limit as a test.
 *
 * A distinctive marker sits in each fact's text so every assertion is on the marker, never on semantics.
 *
 *   1. after delete the fact never reaches the model: not in getForPrompt, not in the `## User Facts`
 *      block, not in getConstraints (so it cannot block an exercise), not in the course-check input;
 *   2. list_facts never shows it, in BOTH modes — includeArchived: true included — while a `user_closed`
 *      fact in the same listing still appears (positive control: the difference between the two reasons);
 *   3. a later compaction of OLDER evidence with a scripted valid `add` (+ update + confirm) for the
 *      deleted fact does not bring it back — the stale-evidence guard AC-FL-3 relies on; a fresh fact in
 *      the same batch IS applied, so the refusal is the guard and not a compaction that did nothing;
 *   4. the honest limit: the row and its text REMAIN in user_facts, and the conversation turns and
 *      summaries written around it are untouched. This is the documented present behaviour — the day
 *      someone needs real erasure, these tests say exactly what is not covered. Backups and logs were
 *      not examined and nothing here claims anything about them.
 */
import type { BaseMessage } from '@langchain/core/messages';
import { and, asc, eq } from 'drizzle-orm';

import { UserFactsRepository } from '@infra/db/repositories/user-facts.repository';
import { db } from '@infra/db/drizzle';
import { conversationSummaries, conversationTurns, userFacts } from '@infra/db/schema';

import { runScenario, type ScenarioRunResult } from '../../../evals/lib/run-scenario';
import { ScenarioSchema, type Scenario } from '../../../evals/schema/scenario.schema';
import { pastWith, summary } from '../../../evals/scenarios/fl-shared';

import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { resolveFactPlaceholders } from './fact-placeholders';
import { installScriptedModel, type ScriptedModelHandle, type StructuredInput } from './scripted-model';

const DELETED = 'RRP6-DELETED Left knee meniscus repair, no deep squats';
const CLOSED = 'RRP6-CLOSED Right shoulder pain when pressing overhead';
const KEPT = 'RRP6-KEPT Trains at home with a barbell and a squat rack';
const FRESH = 'RRP6-FRESH Prefers short, direct replies';

const T0 = new Date('2026-09-21T10:00:00.000Z');

const STALE_STATEMENT = {
  category: 'physical_constraint',
  fact: DELETED,
  muscleGroup: 'quads',
  durability: 'long_term',
  reviewInDays: 30,
  phaseNote: 'after surgery',
};

const scenario: Scenario = {
  id: 'rrp6-delete-guarantee',
  description:
    'A fact is deleted and another closed; later compaction, listings and prompts never bring back the deleted one',
  past: pastWith([
    {
      category: 'physical_constraint',
      fact: DELETED,
      muscleGroup: 'quads',
      durability: 'long_term',
      at: '-10d',
      reviewInDays: 30,
      phaseNote: 'after surgery',
    },
    {
      category: 'physical_constraint',
      fact: CLOSED,
      muscleGroup: 'shoulders_front',
      durability: 'long_term',
      at: '-10d',
      reviewInDays: 30,
      phaseNote: 'after a fall',
    },
    { category: 'equipment', fact: KEPT },
  ]),
  steps: [
    {
      // The ONLY user turn of the first episode: the newest evidence a later summary of it can carry.
      action: 'user',
      text: 'Про колено забудь совсем — удали. А плечо уже в порядке.',
      script: [
        { toolCall: { name: 'manage_fact', args: { operation: 'delete', factId: '{{factId:RRP6-DELETED}}' } } },
        { toolCall: { name: 'manage_fact', args: { operation: 'retract', factId: '{{factId:RRP6-CLOSED}}' } } },
        { text: 'Готово: колено удалено, плечо закрыто.' },
      ],
    },
    { action: 'advance', at: '+5h' },
    {
      // The next run compacts the OLDER episode; its summariser restates the deleted fact three ways.
      action: 'user',
      text: 'Привет',
      structured: {
        summary: summary({
          topics: ['Knee and shoulder'],
          factOperations: [
            { op: 'add', ...STALE_STATEMENT },
            { op: 'update', factId: '{{factId:RRP6-DELETED}}', ...STALE_STATEMENT },
            { op: 'confirm', factId: '{{factId:RRP6-DELETED}}' },
            // Control: a genuinely new fact in the same batch must be applied.
            {
              op: 'add',
              category: 'coaching_preference',
              fact: FRESH,
              durability: 'permanent',
              explicitPermanent: true,
            },
          ],
        }),
      },
      script: [{ text: 'Привет! Чем займёмся?' }],
    },
    {
      action: 'user',
      text: 'Покажи всё, что помнишь, и архивное тоже',
      script: [{ toolCall: { name: 'list_facts', args: { includeArchived: true } } }, { text: 'Вот список.' }],
    },
    {
      action: 'user',
      text: 'А просто, что помнишь сейчас?',
      script: [{ toolCall: { name: 'list_facts', args: {} } }, { text: 'Вот актуальное.' }],
    },
  ],
};

interface StepRecord {
  /** Every chat-model input of the step, one entry per model call. */
  chat: BaseMessage[][];
  structured: StructuredInput[];
}

interface TurnRow {
  id: string;
  role: string;
  kind: string;
  content: string;
  payload: unknown;
}

interface SummaryRow {
  id: string;
  structured: unknown;
  rendered: string;
}

// Duck-typed (_getType, not instanceof): jest.resetModules re-evaluates @langchain/core.
const typeOf = (m: BaseMessage): string => (m as { _getType?: () => string })._getType?.() ?? '';
const textOf = (m: BaseMessage): string =>
  typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');

/** The system prompt(s) of a step — where the `## User Facts` block lives. */
const systemTexts = (rec: StepRecord): string[] =>
  rec.chat
    .flat()
    .filter(m => typeOf(m) === 'system')
    .map(textOf);

/** The LAST list_facts result the model was handed in a step. */
function lastListing(rec: StepRecord): string {
  const tools = rec.chat
    .flat()
    .filter(m => typeOf(m) === 'tool')
    .map(textOf)
    .filter(t => t.includes('Active facts:') || t.includes('Nothing is remembered'));
  const [last] = tools.slice(-1);
  if (last === undefined) {
    throw new Error('the model was never handed a list_facts result in this step');
  }
  return last;
}

describe('what deleting a fact guarantees (AC-RRP-6)', () => {
  let model: ScriptedModelHandle;
  let run: ScenarioRunResult;
  const steps: StepRecord[] = [];
  let turnsAfterDeleteStep: TurnRow[] = [];
  let summariesAfterCompaction: SummaryRow[] = [];
  let now: Date;
  const repo = new UserFactsRepository();

  const loadTurns = async (userId: string): Promise<TurnRow[]> =>
    (
      await db
        .select({
          id: conversationTurns.id,
          role: conversationTurns.role,
          kind: conversationTurns.kind,
          content: conversationTurns.content,
          payload: conversationTurns.payload,
        })
        .from(conversationTurns)
        .where(eq(conversationTurns.userId, userId))
        .orderBy(asc(conversationTurns.createdAt), asc(conversationTurns.id))
    ).map(r => r);

  const loadSummaries = async (userId: string): Promise<SummaryRow[]> =>
    db
      .select({
        id: conversationSummaries.id,
        structured: conversationSummaries.structured,
        rendered: conversationSummaries.rendered,
      })
      .from(conversationSummaries)
      .where(eq(conversationSummaries.userId, userId))
      .orderBy(asc(conversationSummaries.createdAt), asc(conversationSummaries.id));

  beforeAll(async () => {
    expect(ScenarioSchema.parse(scenario)).toBeTruthy();
    model = installScriptedModel();
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);

    // keepTurns 0 / minTurns 0 / minTokens 0: the short first episode is summarised at the gap (as fl-b).
    const env = { EPISODE_KEEP_TURNS: '0', EPISODE_MIN_TURNS: '0', EPISODE_MIN_TOKENS: '0' };
    const previousEnv = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    Object.assign(process.env, env);
    model.reset();
    let userId = '';
    model.setPlaceholderResolver(text => resolveFactPlaceholders(text, userId));
    try {
      run = await runScenario(scenario, {
        courseCheck: 'on',
        onAdvance: at => jest.setSystemTime(at),
        onSeeded: world => {
          ({ userId } = world);
        },
        onStepStart: index => {
          model.clearStructuredScripts();
          model.drainChatInputs();
          model.drainStructuredInputs();
          const step = scenario.steps[index]!;
          if (step.action !== 'user') {
            return;
          }
          model.enqueueChat(step.script ?? []);
          if (step.structured?.summary) {
            model.enqueueStructuredAnswers([JSON.stringify(step.structured.summary)]);
          }
        },
        onStep: async observation => {
          steps.push({ chat: model.drainChatInputs(), structured: model.drainStructuredInputs() });
          if (observation.stepIndex === 0) {
            turnsAfterDeleteStep = await loadTurns(userId);
          }
          if (observation.stepIndex === 2) {
            summariesAfterCompaction = await loadSummaries(userId);
          }
        },
      });
    } finally {
      model.setPlaceholderResolver(null);
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
    now = new Date();
  }, 600_000);

  afterAll(() => {
    jest.useRealTimers();
  });

  const finalFacts = (): ScenarioRunResult['steps'][number]['facts'] => run.steps[run.steps.length - 1]!.facts;
  const rowsWith = (marker: string): ScenarioRunResult['steps'][number]['facts'] =>
    finalFacts().filter(f => f.fact.includes(marker));

  describe('the run itself', () => {
    it('every user step ran to an ok outcome and the script was fully consumed', () => {
      for (const [i, step] of scenario.steps.entries()) {
        if (step.action === 'user') {
          expect(run.steps[i]!.runRow?.outcome).toBe('ok');
        }
      }
      expect(model.chatScriptExhausted).toBe(true);
    });

    it('control: the delete archived the row as user_deleted and the retract as user_closed (both stamped by the user)', () => {
      const afterDelete = run.steps[0]!.facts;
      const deleted = afterDelete.find(f => f.fact.includes('RRP6-DELETED'))!;
      const closed = afterDelete.find(f => f.fact.includes('RRP6-CLOSED'))!;
      expect(deleted).toMatchObject({ status: 'archived', archivedReason: 'user_deleted' });
      expect(deleted.closedByUserAt).not.toBeNull();
      expect(closed).toMatchObject({ status: 'archived', archivedReason: 'user_closed' });
      expect(afterDelete.find(f => f.fact.includes('RRP6-KEPT'))).toMatchObject({ status: 'active' });
    });

    it('control: before the delete the model DID see the fact in its system prompt (the block carries facts at all)', () => {
      expect(systemTexts(steps[0]!).join('\n')).toContain(DELETED);
    });
  });

  describe('1 — a deleted fact never reaches the model', () => {
    it('getForPrompt: the kept and the freshly added facts are there, the deleted and the closed are not', async () => {
      const texts = (await repo.getForPrompt(run.userId, now)).map(f => f.fact);

      expect(texts).toContain(KEPT);
      expect(texts).toContain(FRESH);
      expect(texts.some(t => t.includes('RRP6-DELETED'))).toBe(false);
      expect(texts.some(t => t.includes('RRP6-CLOSED'))).toBe(false);
    });

    it('getConstraints: a deleted (or closed) physical constraint can no longer block an exercise', async () => {
      const texts = (await repo.getConstraints(run.userId, now)).map(f => f.fact);

      expect(texts.some(t => t.includes('RRP6-DELETED'))).toBe(false);
      expect(texts.some(t => t.includes('RRP6-CLOSED'))).toBe(false);
    });

    it.each([2, 3, 4])(
      'the `## User Facts` block of step %i carries the kept fact and neither the deleted nor the closed one',
      stepIndex => {
        const blocks = systemTexts(steps[stepIndex]!).filter(t => t.includes('## User Facts'));

        expect(blocks.length).toBeGreaterThan(0);
        for (const block of blocks) {
          expect(block).toContain(KEPT);
          expect(block).not.toContain('RRP6-DELETED');
          expect(block).not.toContain('RRP6-CLOSED');
        }
      },
    );

    it.each([2, 3, 4])('no system prompt or course-check input of step %i contains the deleted fact', stepIndex => {
      const seen = [
        ...systemTexts(steps[stepIndex]!),
        ...steps[stepIndex]!.structured.filter(s => s.kind === 'course_check').map(s =>
          s.messages.map(textOf).join('\n'),
        ),
      ];

      expect(seen.some(t => t.includes('RRP6-DELETED'))).toBe(false);
    });
  });

  describe('2 — list_facts never shows it, in both modes', () => {
    it('includeArchived: true — the user_closed fact appears (control), the user_deleted fact does not', () => {
      const listing = lastListing(steps[3]!);

      expect(listing).toContain(CLOSED);
      expect(listing).toContain('(reason: user_closed)');
      expect(listing).toContain(KEPT);
      expect(listing).not.toContain('RRP6-DELETED');
      expect(listing).not.toContain('user_deleted');
    });

    it('default listing — active facts only; neither closed nor deleted appear', () => {
      const listing = lastListing(steps[4]!);

      expect(listing).toContain(KEPT);
      expect(listing).not.toContain('RRP6-DELETED');
      expect(listing).not.toContain('RRP6-CLOSED');
    });

    it('the service agrees: listFacts(includeArchived) has the closed row and never the deleted one', async () => {
      const withArchived = await repo.listFacts(run.userId, true, now);
      const without = await repo.listFacts(run.userId, false, now);

      expect(withArchived.archived.map(f => f.fact)).toContain(CLOSED);
      expect([...withArchived.active, ...withArchived.archived].some(f => f.fact.includes('RRP6-DELETED'))).toBe(false);
      expect(without.archived).toEqual([]);
      expect(without.active.some(f => f.fact.includes('RRP6-DELETED'))).toBe(false);
    });
  });

  describe('3 — old evidence cannot bring a deleted fact back', () => {
    it('control: the summariser was really consulted and applied the batch — the fresh fact was added', () => {
      expect(steps[2]!.structured.filter(s => s.kind === 'summary').length).toBeGreaterThan(0);
      expect(rowsWith('RRP6-FRESH')).toHaveLength(1);
      expect(rowsWith('RRP6-FRESH')[0]).toMatchObject({ status: 'active' });
    });

    it('a scripted add, update and confirm for the deleted fact change nothing: one row, still user_deleted, no active twin', () => {
      const before = run.steps[0]!.facts.find(f => f.fact.includes('RRP6-DELETED'))!;
      const after = rowsWith('RRP6-DELETED');

      expect(after).toHaveLength(1);
      expect(after[0]).toEqual(before); // id, status, reason, closure stamp, confirmations, links — all untouched
      expect(finalFacts().some(f => f.fact.includes('RRP6-DELETED') && f.status === 'active')).toBe(false);
    });
  });

  describe('4 — the documented limit: deleting archives, it does not erase', () => {
    it("the deleted fact's row and its full text REMAIN in user_facts (archived, user_deleted)", async () => {
      const rows = await db
        .select()
        .from(userFacts)
        .where(and(eq(userFacts.userId, run.userId), eq(userFacts.fact, DELETED)));

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'archived', archivedReason: 'user_deleted', fact: DELETED });
    });

    it('the conversation turns written around the deletion are untouched by it and by later compaction', async () => {
      const turnsNow = await loadTurns(run.userId);

      expect(turnsAfterDeleteStep.length).toBeGreaterThan(0);
      expect(turnsNow.slice(0, turnsAfterDeleteStep.length)).toEqual(turnsAfterDeleteStep);
    });

    it('the summaries written by compaction are untouched by the listings that followed', async () => {
      const summariesNow = await loadSummaries(run.userId);

      expect(summariesAfterCompaction.length).toBeGreaterThan(0);
      expect(summariesNow.slice(0, summariesAfterCompaction.length)).toEqual(summariesAfterCompaction);
    });
  });
});
