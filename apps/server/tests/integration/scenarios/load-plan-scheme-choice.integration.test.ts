/**
 * load-plan plan Task 5a (AC-LP-5, D8, A6), real test DB: the user says he wants to progress by reps; the real
 * compaction step (summariser + verifier stubbed) stores a `progression_scheme` fact from his words; the training
 * context (real PhaseSpec.loadContext) then says "chosen by user <date>" — before it, and without the fact, the
 * block says "default, unconfirmed". With LOAD_PLAN_SUGGESTION off nothing is written and nothing is printed.
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages';

import type { LlmGateway } from '@domain/ai/ports';
import type { SummaryPort } from '@domain/conversation/ports';

import { buildCompactStep } from '@infra/ai/graph/nodes/compact.node';
import { buildTrainingSpec } from '@infra/ai/graph/phases/training.spec';
import { RunMetricsCollector } from '@infra/ai/run-metrics';
import { db } from '@infra/db/drizzle';
import { UserFactsRepository } from '@infra/db/repositories/user-facts.repository';
import { workoutSessions } from '@infra/db/schema';

import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';

const TIMEZONE = 'Asia/Manila';
/** 17:30 in Manila on 2026-09-29. */
const NOW = new Date('2026-09-29T09:30:00.000Z');
const SCHEME_FACT = 'progression_scheme id=double_progression — хочу прогрессию по повторам';
const QUOTE = 'хочу прогрессию по повторам';

describe('progression_scheme: chosen by user vs default (AC-LP-5)', () => {
  const { service, userRepo, exerciseRepo, sessionRepo, sessionExerciseRepo, sessionSetRepo } =
    buildRealTrainingService();
  const userFacts = new UserFactsRepository();
  let userId: string;
  let benchId: string;
  let todayId: string;
  // A beginner with a strength goal: the D8 default is LINEAR; the choice below is DOUBLE, so the two differ.
  const profile = { timezone: TIMEZONE, fitnessLevel: 'beginner', fitnessGoal: 'get stronger' };

  async function seedWorkout(
    at: Date,
    status: 'completed' | 'in_progress',
    sets: number[] = [],
    planReps?: string,
  ): Promise<string> {
    const [row] = await db
      .insert(workoutSessions)
      .values({
        userId,
        sessionKey: `lps_${at.toISOString()}`,
        status,
        startedAt: at,
        completedAt: status === 'completed' ? new Date(at.getTime() + 3_600_000) : null,
        lastActivityAt: at,
        createdAt: at,
        updatedAt: at,
        sessionPlanJson: planReps
          ? {
              sessionKey: 'lps',
              sessionName: 'lps',
              reasoning: 'seed',
              estimatedDuration: 30,
              exercises: [
                {
                  exerciseId: benchId,
                  exerciseName: 'Barbell Bench Press',
                  targetSets: 3,
                  targetReps: planReps,
                  restSeconds: 90,
                },
              ],
            }
          : null,
      })
      .returning();
    if (sets.length > 0) {
      const se = await sessionExerciseRepo.create(row.id, { exerciseId: benchId, orderIndex: 0, targetReps: '8-12' });
      for (const [i, reps] of sets.entries()) {
        await sessionSetRepo.create(se.id, {
          setData: { type: 'strength', reps, weight: 60, weightUnit: 'kg' },
          createdAt: new Date(at.getTime() + 600_000 + i * 120_000),
          setKind: 'working',
        });
      }
    }
    return row.id;
  }

  const deps = (flags: Record<string, boolean>) =>
    ({
      trainingService: service,
      workoutSessionRepo: sessionRepo,
      exerciseRepository: exerciseRepo,
      embeddingService: {},
      userService: {},
      userFacts,
      ...flags,
    }) as never;

  /** The training context text (every block) as the model would get it. */
  async function contextText(flags: Record<string, boolean>): Promise<string> {
    const d = deps(flags);
    const spec = buildTrainingSpec(d);
    const loaded = await spec.loadContext({ userId, user: profile as never, activeSessionId: todayId, now: NOW }, d);
    if (!loaded.ok) {
      throw new Error(`loadContext failed: ${loaded.reply}`);
    }
    return spec.contextBlocks
      .map(b => b.render(loaded.data as never, { now: NOW, timezone: TIMEZONE, user: null }, 0))
      .filter(Boolean)
      .join('\n');
  }

  /** One compaction of an episode in which the user said he wants progression by reps. */
  async function compactEpisode(flags: { loadPlanSuggestion?: boolean; loadPlanBreaks?: boolean }): Promise<void> {
    const structured = jest.fn().mockImplementation((_s: unknown, _m: unknown, opts: { schemaName?: string }) =>
      Promise.resolve(
        opts.schemaName === 'episode_summary_v4'
          ? {
              topics: ['progression'],
              decisions: [],
              userState: [],
              trainingFeedback: [],
              openItems: [],
              factOperations: [
                {
                  op: 'add',
                  category: 'progression_scheme',
                  fact: SCHEME_FACT,
                  durability: 'long_term',
                  evidence: QUOTE,
                },
              ],
            }
          : { verdicts: [{ index: 0, supported: true, reason: 'the user asked for it', userQuote: QUOTE }] },
      ),
    );
    const compact = buildCompactStep({
      llmGateway: { chat: jest.fn(), structured } as unknown as LlmGateway,
      summaries: {
        insert: jest.fn().mockRejectedValue(new Error('not needed')),
        latestLegacySummary: jest.fn().mockResolvedValue(null),
      } as unknown as SummaryPort,
      userFacts,
      config: { gapMs: 3 * 3_600_000, minTurns: 0, minTokens: 0, keepTurns: 1 },
      budgetFor: () => 1_000_000,
      ...flags,
    });
    await compact(
      {
        phase: 'chat',
        activeSessionId: null,
        messages: [
          new HumanMessage({ content: 'Хочу прогрессию по повторам, а не по весу', id: 'm0' }),
          new AIMessage({ content: 'Хорошо, будем так', id: 'm0a', tool_calls: [] }),
          new HumanMessage({ content: 'Что сегодня?', id: 'm1' }),
          new AIMessage({ content: 'Грудь', id: 'm2', tool_calls: [] }),
          new HumanMessage({ content: 'Ок', id: 'm3' }),
        ],
        pendingTransition: null,
        episodeSummaries: [],
        episodeId: 'e1',
        episodeStartedAt: new Date(NOW.getTime() - 8 * 3_600_000).toISOString(),
        lastUserMessageAt: new Date(NOW.getTime() - 4 * 3_600_000).toISOString(),
        compactReason: null,
        courseDirective: null,
        courseCheckFailure: null,
        courseExpiryQuestions: [],
      } as never,
      {
        configurable: { thread_id: userId },
        context: {
          runId: 'lps-run',
          userId,
          user: { id: userId, timezone: TIMEZONE } as never,
          now: NOW,
          client: 'telegram',
          trigger: 'user_message',
          metrics: new RunMetricsCollector('lps-run'),
        },
      } as never,
    );
  }

  const schemeFacts = async () =>
    (await userFacts.listFacts(userId, true, NOW)).active.filter(f => f.category === 'progression_scheme');

  beforeAll(async () => {
    const bench = (await exerciseRepo.findAll()).find(e => e.name === 'Barbell Bench Press');
    if (!bench) {
      throw new Error('Seed exercise "Barbell Bench Press" not found — run with RUN_DB_TESTS=1');
    }
    benchId = bench.id;
    userId = (await userRepo.create(createTestUserData({ username: `lps_${Date.now()}` }))).id;
    await seedWorkout(new Date(NOW.getTime() - 10 * 86_400_000), 'completed', [10, 10, 9]);
    await seedWorkout(new Date(NOW.getTime() - 3 * 86_400_000), 'completed', [10, 10, 10]);
    todayId = await seedWorkout(new Date(NOW.getTime() - 40 * 60_000), 'in_progress', [], '8-12');
  });

  it('without the fact: the block says default, unconfirmed (beginner + strength → linear)', async () => {
    const text = await contextText({ loadPlanSuggestion: true });
    expect(text).toContain('Progression: linear, confirm ×2 — default, unconfirmed');
    expect(text).toContain('scheme: linear progression 5 (scheme default), confirm ×2 (default, unconfirmed)');
  });

  it('flag off: nothing is stored from the conversation (the category is dropped at apply time)', async () => {
    await compactEpisode({});
    expect(await schemeFacts()).toHaveLength(0);
    await compactEpisode({ loadPlanBreaks: true });
    expect(await schemeFacts()).toHaveLength(0);
  });

  it('after compaction with LOAD_PLAN_SUGGESTION on: the fact is stored from the user’s words and the block says chosen by user <date>', async () => {
    await compactEpisode({ loadPlanSuggestion: true });
    const facts = await schemeFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0].fact).toBe(SCHEME_FACT);
    expect(facts[0].evidence).toBe(QUOTE);
    expect(facts[0].durability).toBe('long_term');

    const text = await contextText({ loadPlanSuggestion: true });
    expect(text).toContain('Progression: double, confirm ×2 — chosen by user 2026-09-29');
    expect(text).toContain('scheme: double progression 8–12, confirm ×2 (chosen by user 2026-09-29)');
    expect(text).not.toContain('default, unconfirmed');
    // One rep range per entry (today's plan), none contradicting it on the Progression line.
    expect(text).not.toContain('4–6');
  });

  it('LOAD_PLAN_SUGGESTION off: the v1 block, no Progression line, whatever facts exist', async () => {
    const text = await contextText({});
    expect(text).toContain('=== LOAD PLAN (computed facts — no recommendation) ===');
    expect(text).not.toContain('Progression:');
    expect(text).not.toContain('scheme:');
  });
});
