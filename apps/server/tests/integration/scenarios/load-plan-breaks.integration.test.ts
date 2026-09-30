/**
 * load-plan plan Task 4 (AC-LP-6, D5, D9), dated clock, real test DB: a 30-day gap prints the tier and the ladder
 * step; the next conversation is told to ask the reason once (a `break` fact with reason `unknown` is the marker,
 * so a new BreakContext — a restart — does not ask again); the user's answer, applied by the real compaction step
 * (summariser + verifier stubbed), is stored as a `break` fact that selects the branch; after a workout in range
 * with reserve the ladder advances; a miss repeats the rung. With LOAD_PLAN_BREAKS off nothing of this shows.
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages';

import type { LlmGateway } from '@domain/ai/ports';
import type { SummaryPort } from '@domain/conversation/ports';
import { defaultProgression } from '@domain/training/load-plan';

import { BreakContext } from '@infra/ai/load-facts/break-context';
import { loadLoadPlanEntries } from '@infra/ai/load-facts/load-facts.loader';
import { buildCompactStep } from '@infra/ai/graph/nodes/compact.node';
import { renderLoadPlanEntryV2 } from '@infra/ai/prompts/blocks/training-load-plan.v2';
import { RunMetricsCollector } from '@infra/ai/run-metrics';
import { db } from '@infra/db/drizzle';
import { UserFactsRepository } from '@infra/db/repositories/user-facts.repository';
import { workoutSessions } from '@infra/db/schema';

import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';

const TIMEZONE = 'Asia/Manila';
/** 17:30 in Manila on 2026-09-29 — "today" of the scenario. */
const NOW = new Date('2026-09-29T09:30:00.000Z');
const DAY = 86_400_000;
const daysFrom = (base: Date, days: number): Date => new Date(base.getTime() + days * DAY);

describe('breaks: tier, reason question, ladder (AC-LP-6)', () => {
  const { userRepo, exerciseRepo, sessionRepo, sessionExerciseRepo, sessionSetRepo, service } =
    buildRealTrainingService();
  const userFacts = new UserFactsRepository();
  let userId: string;
  let benchId: string;

  async function seedWorkout(
    at: Date,
    status: 'completed' | 'in_progress',
    sets: { weight: number; reps: number; rpe?: number }[] = [],
    planTargetReps?: string,
  ): Promise<string> {
    const [row] = await db
      .insert(workoutSessions)
      .values({
        userId,
        sessionKey: `lpb_${at.toISOString()}`,
        status,
        startedAt: at,
        completedAt: status === 'completed' ? new Date(at.getTime() + 3_600_000) : null,
        lastActivityAt: at,
        createdAt: at,
        updatedAt: at,
        sessionPlanJson: planTargetReps
          ? {
              sessionKey: 'lpb',
              sessionName: 'lpb',
              reasoning: 'seed',
              estimatedDuration: 30,
              exercises: [
                {
                  exerciseId: benchId,
                  exerciseName: 'Barbell Bench Press',
                  targetSets: 3,
                  targetReps: planTargetReps,
                  restSeconds: 90,
                },
              ],
            }
          : null,
      })
      .returning();
    if (sets.length > 0) {
      const se = await sessionExerciseRepo.create(row.id, { exerciseId: benchId, orderIndex: 0, targetReps: '8-12' });
      for (const [i, s] of sets.entries()) {
        await sessionSetRepo.create(se.id, {
          setData: { type: 'strength', reps: s.reps, weight: s.weight, weightUnit: 'kg' },
          rpe: s.rpe,
          createdAt: new Date(at.getTime() + 600_000 + i * 120_000),
          setKind: 'working',
        });
      }
    }
    return row.id;
  }

  /** The LOAD PLAN v2 entry of the bench for a (dated) today; `breaks` is the flag. */
  async function loadPlanAt(now: Date, breaks: boolean): Promise<string> {
    const todayId = await seedWorkout(now, 'in_progress', [], '8-12');
    const session = await service.getSessionDetails(todayId);
    const [entry] = await loadLoadPlanEntries(
      {
        workoutSessionRepo: sessionRepo,
        exerciseRepository: exerciseRepo,
        trainingService: { getSessionDetails: id => sessionRepo.findByIdWithDetails(id) },
        userFacts,
      },
      {
        userId,
        session,
        exerciseIds: [benchId],
        planTargetReps: new Map([[benchId, '8-12']]),
        now,
        timezone: TIMEZONE,
        breaks,
      },
    );
    // One in_progress session per user (INV-TRAINING-002): close the helper session again.
    await db
      .update(workoutSessions)
      .set({ status: 'completed', completedAt: null })
      .where((await import('drizzle-orm')).eq(workoutSessions.id, todayId));
    return renderLoadPlanEntryV2(
      entry,
      { now, timezone: TIMEZONE, user: null },
      { progression: defaultProgression(null) },
    );
  }

  const breakContext = (): BreakContext => new BreakContext({ workoutSessionRepo: sessionRepo, userFacts });
  const breakFacts = async () =>
    (await userFacts.listFacts(userId, true, NOW)).active.filter(f => f.category === 'break');

  beforeAll(async () => {
    const bench = (await exerciseRepo.findAll()).find(e => e.name === 'Barbell Bench Press');
    if (!bench) {
      throw new Error('Seed exercise "Barbell Bench Press" not found — run with RUN_DB_TESTS=1');
    }
    benchId = bench.id;
    userId = (await userRepo.create(createTestUserData({ username: `lpb_${Date.now()}` }))).id;
    // Two workouts, the last one 30 days before NOW: a 30-day gap (tier rebuild), 10 days between them.
    await seedWorkout(daysFrom(NOW, -40), 'completed', [
      { weight: 80, reps: 10 },
      { weight: 80, reps: 10 },
      { weight: 80, reps: 10 },
    ]);
    await seedWorkout(daysFrom(NOW, -30), 'completed', [
      { weight: 80, reps: 10 },
      { weight: 80, reps: 10 },
      { weight: 80, reps: 10 },
    ]);
  });

  it('flag off: the LOAD PLAN prints no break line and the ladder is the Task 2 stub', async () => {
    const text = await loadPlanAt(NOW, false);
    expect(text).not.toContain('break:');
    expect(text).toContain('decision: Stage A, gap tier rebuild');
    expect(await breakFacts()).toHaveLength(0);
  });

  it('a 30-day gap: the tier and ladder step 1 of 3 are printed, the reason unknown (no answer yet)', async () => {
    const text = await loadPlanAt(NOW, true);
    expect(text).toContain('break: tier rebuild (general norm) · return workout 1 of 3 · reason unknown');
    expect(text).toContain('decision: Stage A, gap tier rebuild');
    // rebuild: two steps below 80 (step 2.5), and unknown one more → 72.5
    expect(text).toContain('recommend: 72.5 kg');
  });

  it('the next conversation: told to ask once; the marker is a break fact; a restarted process does not ask again', async () => {
    const first = await breakContext().resolve(userId, NOW, TIMEZONE);
    expect(first).toEqual({ tier: 'rebuild', days: 30, ask: true });
    const facts = await breakFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0].fact).toBe('break reason=unknown from=2026-08-30 to=2026-09-29');
    expect(facts[0].durability).toBe('short');
    expect(facts[0].expiresAt).not.toBeNull();
    // A new instance (a restart) and a later message the same day: nothing is asked again, nothing is written.
    const again = await breakContext().resolve(userId, new Date(NOW.getTime() + 3_600_000), TIMEZONE);
    expect(again).toEqual({ tier: 'rebuild', days: 30, ask: false });
    expect(await breakFacts()).toHaveLength(1);
  });

  it('the user answers: the real compaction step stores the answer as a break fact (supersedes the placeholder)', async () => {
    const [marker] = await breakFacts();
    const answer = `break reason=illness from=2026-08-30 to=2026-09-27 — I had the flu`;
    const structured = jest
      .fn()
      .mockImplementation((_schema: unknown, _messages: unknown, opts: { schemaName?: string }) =>
        Promise.resolve(
          opts.schemaName === 'episode_summary_v4'
            ? {
                topics: ['break'],
                decisions: [],
                userState: [],
                trainingFeedback: [],
                openItems: [],
                factOperations: [
                  {
                    op: 'update',
                    factId: marker.id,
                    category: 'break',
                    fact: answer,
                    durability: 'short',
                    evidence: 'болел гриппом',
                  },
                ],
              }
            : {
                verdicts: [
                  { index: 0, supported: true, reason: 'the user says they had the flu', userQuote: 'болел гриппом' },
                ],
              },
        ),
      );
    const compact = buildCompactStep({
      llmGateway: { chat: jest.fn(), structured } as unknown as LlmGateway,
      // insert rejects → no summary turn FK; the operations still apply with sourceTurnId undefined.
      summaries: {
        insert: jest.fn().mockRejectedValue(new Error('not needed')),
        latestLegacySummary: jest.fn().mockResolvedValue(null),
      } as unknown as SummaryPort,
      userFacts,
      config: { gapMs: 3 * 3_600_000, minTurns: 0, minTokens: 0, keepTurns: 1 },
      budgetFor: () => 1_000_000,
      loadPlanBreaks: true,
    });
    const now = new Date(NOW.getTime() + 4 * 3_600_000);
    await compact(
      {
        phase: 'chat',
        activeSessionId: null,
        messages: [
          new HumanMessage({ content: 'Почему так долго не тренировался? — болел гриппом', id: 'm0' }),
          new AIMessage({ content: 'Понял, выздоравливай', id: 'm0a', tool_calls: [] }),
          new HumanMessage({ content: 'Составь план', id: 'm1' }),
          new AIMessage({ content: 'Готовим', id: 'm2', tool_calls: [] }),
          new HumanMessage({ content: 'Спасибо', id: 'm3' }),
        ],
        pendingTransition: null,
        episodeSummaries: [],
        episodeId: 'e1',
        episodeStartedAt: NOW.toISOString(),
        lastUserMessageAt: NOW.toISOString(),
        compactReason: null,
        courseDirective: null,
        courseCheckFailure: null,
        courseExpiryQuestions: [],
      } as never,
      {
        configurable: { thread_id: userId },
        context: {
          runId: 'lpb-run',
          userId,
          user: { id: userId, timezone: TIMEZONE } as never,
          now,
          client: 'telegram',
          trigger: 'user_message',
          metrics: new RunMetricsCollector('lpb-run'),
        },
      } as never,
    );

    const facts = await breakFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0].fact).toBe(answer);
    expect(facts[0].supersedesId).toBe(marker.id);
    expect(facts[0].durability).toBe('short');
    expect(facts[0].evidence).toBe('болел гриппом');
    // The answered break is still "asked": no second question.
    expect(await breakContext().resolve(userId, now, TIMEZONE)).toMatchObject({ ask: false });
  });

  it('the answer selects the branch: illness → one step lower and a well-being check in the LOAD PLAN', async () => {
    const text = await loadPlanAt(NOW, true);
    expect(text).toContain('reason illness');
    expect(text).toContain('well-being check');
  });

  it('after a workout in range with reserve the ladder advances to workout 2 of 3 (gap closed, tier shown from the ladder)', async () => {
    await seedWorkout(daysFrom(NOW, 1), 'completed', [
      { weight: 72.5, reps: 10, rpe: 7 },
      { weight: 72.5, reps: 10, rpe: 7 },
      { weight: 72.5, reps: 9, rpe: 8 },
    ]);
    const text = await loadPlanAt(daysFrom(NOW, 3), true);
    expect(text).toContain('break: tier rebuild (general norm) · return workout 2 of 3 · reason illness');
    expect(text).toContain('decision: Stage A, gap tier rebuild');
  });

  it('a workout without reserve (RPE 9) repeats the rung', async () => {
    await seedWorkout(daysFrom(NOW, 4), 'completed', [
      { weight: 75, reps: 10, rpe: 9 },
      { weight: 75, reps: 9, rpe: 9 },
      { weight: 75, reps: 9, rpe: 9 },
    ]);
    const text = await loadPlanAt(daysFrom(NOW, 6), true);
    // Workouts since the gap: day +1 (success) and day +4 (miss) → still rung 2.
    expect(text).toContain('return workout 2 of 3');
  });
});
