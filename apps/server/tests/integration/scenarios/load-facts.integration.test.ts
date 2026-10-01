/**
 * load-facts plan AC-LF-5 (and the repository count behind D11): over the real test DB, a seeded
 * history — two Bench Press workouts on different days (one with an explicit warm-up), and today a
 * triceps exercise done before the bench — renders the expected reference, working weight, gap
 * days and `after N working sets on triceps` in the training context and in the `get_load_plan`
 * tool. Real training PhaseSpec.loadContext over real repositories; "now" is pinned.
 */
import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';

import { buildTrainingSpec } from '@infra/ai/graph/phases/training.spec';
import { buildGetLoadPlanTool } from '@infra/ai/tools/get-load-plan.tool';
import { toToolMessage } from '@infra/ai/tools/outcome';
import { db } from '@infra/db/drizzle';
import { UserFactsRepository } from '@infra/db/repositories/user-facts.repository';
import { exerciseMuscleGroups, exercises, workoutSessions } from '@infra/db/schema';

import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';

/** 17:30 in Manila on 2026-09-29. */
const NOW = new Date('2026-09-29T09:30:00.000Z');
const TIMEZONE = 'Asia/Manila';
/** Test-local triceps exercise (setup.ts seeds a handful only); fixed UUID, idempotent insert. */
const PUSHDOWN_ID = '2f2f7a26-1bd0-4702-829a-71d4a3f5e0a1';

describe('LOAD PLAN over the real DB (AC-LF-5)', () => {
  const {
    service: trainingService,
    userRepo,
    exerciseRepo,
    sessionRepo,
    sessionExerciseRepo,
    sessionSetRepo,
  } = buildRealTrainingService();
  const userFacts = new UserFactsRepository();
  let userId: string;
  let todayId: string;
  let benchId: string;

  const at = (iso: string): Date => new Date(iso);

  async function seedSession(
    status: 'completed' | 'in_progress',
    startedAt: Date,
    plan: { exerciseId: string; exerciseName: string; targetReps: string }[] = [],
  ): Promise<string> {
    const [row] = await db
      .insert(workoutSessions)
      .values({
        userId,
        sessionKey: `lf_${startedAt.toISOString()}`,
        status,
        startedAt,
        completedAt: status === 'completed' ? new Date(startedAt.getTime() + 3_600_000) : null,
        lastActivityAt: startedAt,
        createdAt: startedAt,
        updatedAt: startedAt,
        sessionPlanJson: plan.length
          ? {
              sessionKey: 'lf',
              sessionName: 'lf',
              reasoning: 'seed',
              estimatedDuration: 30,
              exercises: plan.map(p => ({ ...p, targetSets: 3, restSeconds: 90 })),
            }
          : null,
      })
      .returning();
    return row.id;
  }

  async function seedExercise(
    sessionId: string,
    exerciseId: string,
    orderIndex: number,
    sets: { weight: number; reps: number; at: Date; kind?: 'warmup' | 'working' }[],
  ): Promise<void> {
    const se = await sessionExerciseRepo.create(sessionId, { exerciseId, orderIndex });
    for (const s of sets) {
      await sessionSetRepo.create(se.id, {
        setData: { type: 'strength', reps: s.reps, weight: s.weight, weightUnit: 'kg' },
        createdAt: s.at,
        setKind: s.kind ?? 'working',
      });
    }
  }

  beforeAll(async () => {
    await db
      .insert(exercises)
      .values({
        id: PUSHDOWN_ID,
        name: 'Load Facts Pushdown',
        category: 'isolation',
        equipment: 'cable',
        exerciseType: 'strength',
        description: 'Triceps isolation',
        energyCost: 'low',
        complexity: 'beginner',
        typicalDurationMinutes: 8,
        requiresSpotter: false,
      })
      .onConflictDoNothing();
    await db
      .insert(exerciseMuscleGroups)
      .values([{ exerciseId: PUSHDOWN_ID, muscleGroup: 'triceps', involvement: 'primary' }])
      .onConflictDoNothing();

    const bench = (await exerciseRepo.findAll()).find(e => e.name === 'Barbell Bench Press');
    if (!bench) {
      throw new Error('Seed exercise "Barbell Bench Press" not found — run with RUN_DB_TESTS=1');
    }
    benchId = bench.id;

    userId = (await userRepo.create(createTestUserData({ username: `load_facts_${Date.now()}` }))).id;

    // Two past bench workouts on different days; the first has an explicit warm-up.
    const w1 = await seedSession('completed', at('2026-09-20T05:00:00Z'));
    await seedExercise(w1, benchId, 0, [
      { weight: 40, reps: 10, at: at('2026-09-20T05:05:00Z'), kind: 'warmup' },
      { weight: 80, reps: 10, at: at('2026-09-20T05:10:00Z') },
      { weight: 80, reps: 10, at: at('2026-09-20T05:13:00Z') },
    ]);
    const w2 = await seedSession('completed', at('2026-09-26T05:00:00Z'));
    await seedExercise(w2, benchId, 0, [
      { weight: 82, reps: 10, at: at('2026-09-26T05:10:00Z') },
      { weight: 82, reps: 10, at: at('2026-09-26T05:13:00Z') },
      { weight: 82, reps: 9, at: at('2026-09-26T05:16:00Z') },
    ]);

    // Today: 6 pushdown sets first, the bench is planned but not started.
    todayId = await seedSession('in_progress', at('2026-09-29T08:50:00Z'), [
      { exerciseId: benchId, exerciseName: 'Barbell Bench Press', targetReps: '8-12' },
    ]);
    await seedExercise(
      todayId,
      PUSHDOWN_ID,
      0,
      Array.from({ length: 6 }, (_, i) => ({
        weight: 30,
        reps: 12,
        at: new Date(at('2026-09-29T08:55:00Z').getTime() + i * 120_000),
      })),
    );
  });

  const deps = () =>
    ({
      trainingService,
      workoutSessionRepo: sessionRepo,
      exerciseRepository: exerciseRepo,
      embeddingService: {},
      userService: {},
      userFacts,
    }) as never;

  it('the training context carries LOAD PLAN with reference, working weight, gap and fatigue', async () => {
    const spec = buildTrainingSpec(deps());
    const loaded = await spec.loadContext(
      { userId, user: { timezone: TIMEZONE } as never, activeSessionId: todayId, now: NOW },
      deps(),
    );
    if (!loaded.ok) {
      throw new Error(`loadContext failed: ${loaded.reply}`);
    }
    // Facts use the run clock and the user timezone.
    const context = spec.contextBlocks
      .map(b => b.render(loaded.data as never, { now: NOW, timezone: TIMEZONE, user: null }, 0))
      .filter(Boolean)
      .join('\n');

    expect(context).toContain('=== LOAD PLAN (computed facts — no recommendation) ===');
    expect(context).toMatch(/Barbell Bench Press \[ID:[0-9a-f-]+\]\n {2}reference: 2026-09-26/);
    // The warm-up (40 kg) is not a working set; heaviest qualifying load over both workouts is 82.
    expect(context).toContain('working weight 82 kg (2 performances / 8 wk)');
    expect(context).not.toContain('40 kg');
    // 2026-09-26 -> 2026-09-29 in Manila.
    expect(context).toContain('gap: exercise 3 d');
    expect(context).toContain('today: after 6 working sets on triceps (Load Facts Pushdown)');
    expect(context).toContain('data: 2 performances in 8 wk, 2 all-time');
    // D2: the reference is the row EXERCISE HISTORY shows.
    expect(context).toContain('sets as in EXERCISE HISTORY');
  });

  it('LOAD_PLAN_SUGGESTION on: the context carries LOAD PLAN v2 — the suggestion with its decision row (AC-LP-3)', async () => {
    const on = { ...(deps() as object), loadPlanSuggestion: true } as never;
    const spec = buildTrainingSpec(on);
    const loaded = await spec.loadContext(
      { userId, user: { timezone: TIMEZONE } as never, activeSessionId: todayId, now: NOW },
      on,
    );
    if (!loaded.ok) {
      throw new Error(`loadContext failed: ${loaded.reply}`);
    }
    const context = spec.contextBlocks
      .map(b => b.render(loaded.data as never, { now: NOW, timezone: TIMEZONE, user: null }, 0))
      .filter(Boolean)
      .join('\n');

    expect(context).toMatch(/=== LOAD PLAN \(computed facts and a suggestion with its reason — you decide the load/);
    expect(context).not.toContain('=== LOAD PLAN (computed facts — no recommendation) ===');
    // The v1 fact lines are still there.
    expect(context).toContain('working weight 82 kg (2 performances / 8 wk)');
    expect(context).toContain('gap: exercise 3 d');
    // v2 lines: default scheme (no profile), no tactic, the Stage A pre-fatigue row (6 triceps sets today, none
    // before the reference), the suggestion one step down with the conservative option below it.
    expect(context).toContain('scheme: double progression 8–12, confirm ×2 (default, unconfirmed)');
    expect(context).toContain('tactic: none active');
    // The seeded 82 kg barbell: one confirmed off-grid load only, so the step is unknown (W-37) — the row steps down to the
    // nearest RECORDED lighter load (80) and says so; no counted step, no made-up load.
    expect(context).toContain('step: recorded loads do not fit one step');
    expect(context).toContain('decision: Stage A, pre-fatigue delta → nearest recorded lighter load');
    expect(context).toMatch(/recommend: 80 kg × 8–12 — 6 more working sets on a shared muscle today/);
    expect(context).toMatch(/conservative: 80 kg × 8–12 — no lighter option on record/);
    expect(context).toMatch(/confidence: (low|medium|high) \(/);
    // No record for the pushdown: no number and no conservative option (AC-LPF-3).
    expect(context).toContain('recommend: no number — no record, no reference load');
  });

  it('get_load_plan returns the same facts, with the sets in full', async () => {
    const tool = buildGetLoadPlanTool({
      trainingService,
      exerciseRepository: exerciseRepo,
      workoutSessionRepo: sessionRepo,
      userFacts,
    }) as unknown as { invoke: (i: Record<string, unknown>, c: unknown) => Promise<unknown> };
    const ret = (await tool.invoke(
      { exerciseId: benchId },
      {
        configurable: { userId, activeSessionId: todayId, thread_id: userId },
        context: { runId: 'run-test', userId, now: NOW, user: { timezone: TIMEZONE } },
      },
    )) as ToolReturn;
    const text = String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'id').content);

    expect(text).toContain('reference: 2026-09-26');
    expect(text).toContain('10 reps @ 82 kg; 10 reps @ 82 kg; 9 reps @ 82 kg');
    expect(text).toContain('working weight 82 kg (2 performances / 8 wk)');
    expect(text).toContain('gap: exercise 3 d');
    expect(text).toContain('after 6 working sets on triceps');
  });

  it('countRealPerformancesByExercise counts all-time real performances, excluding the given session', async () => {
    const counts = await sessionRepo.countRealPerformancesByExercise(userId, [benchId, PUSHDOWN_ID], todayId);
    expect(counts.get(benchId)).toBe(2);
    expect(counts.has(PUSHDOWN_ID)).toBe(false);
    const withToday = await sessionRepo.countRealPerformancesByExercise(userId, [PUSHDOWN_ID], null);
    // Today's session is in progress, not completed: still not a real performance.
    expect(withToday.get(PUSHDOWN_ID)).toBeUndefined();
    expect(await sessionRepo.countRealPerformancesByExercise(userId, [], null)).toEqual(new Map());
  });
});
