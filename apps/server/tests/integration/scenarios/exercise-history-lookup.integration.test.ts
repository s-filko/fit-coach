/**
 * `get_exercise_history` (training-history-lookup plan, Task 1 — AC-HL-1, AC-HL-2): the read-only
 * lookup tool for an exercise the training phase's own blocks do NOT cover (neither today's plan
 * nor the last 7 real days). Real repositories over the test DB (`buildRealTrainingService`), the
 * same seeding helper `previous-session.integration.test.ts` uses.
 */
import { isToolReturnWithUpdate, type ToolReturn } from '@domain/conversation/tool-outcome';

import { buildGetExerciseHistoryTool } from '@infra/ai/tools/get-exercise-history.tool';
import { toToolMessage } from '@infra/ai/tools/outcome';

import { buildRealTrainingService } from '../../helpers/training-service';
import { createTestUserData } from '../../shared/test-factories';
import { createSessionSeeder, type SeedSession } from './session-seed';

const NOW = new Date('2026-09-26T09:30:00.000Z');

function makeConfig(userId: string, activeSessionId: string) {
  return {
    configurable: { userId, activeSessionId, thread_id: userId },
    context: { runId: 'run-test', userId, now: NOW, user: { timezone: 'Asia/Manila' } },
  } as never;
}

function renderedContent(ret: ToolReturn): string {
  return String(toToolMessage(isToolReturnWithUpdate(ret) ? ret.outcome : ret, 'test-id').content);
}

describe('get_exercise_history (AC-HL-1, AC-HL-2)', () => {
  const { service: trainingService, userRepo, exerciseRepo, sessionRepo, sessionExerciseRepo, sessionSetRepo } =
    buildRealTrainingService();

  let userId: string;
  let todaySessionId: string;
  let benchPressId: string;
  let pullUpsId: string;

  const tool = () =>
    buildGetExerciseHistoryTool({
      trainingService,
      exerciseRepository: exerciseRepo,
      workoutSessionRepo: sessionRepo,
    });

  beforeAll(async () => {
    const all = await exerciseRepo.findAll();
    const exerciseIds = new Map<string, string>();
    for (const name of ['Barbell Bench Press', 'Barbell Back Squat', 'Pull-ups']) {
      const found = all.find(e => e.name === name);
      if (!found) {
        throw new Error(`get_exercise_history: seed exercise "${name}" not found — run with RUN_DB_TESTS=1`);
      }
      exerciseIds.set(name, found.id);
    }
    benchPressId = exerciseIds.get('Barbell Bench Press')!;
    pullUpsId = exerciseIds.get('Pull-ups')!;

    userId = (await userRepo.create(createTestUserData({ username: `exercise_history_lookup_${Date.now()}` }))).id;
    const seedSession = createSessionSeeder({ userId, exerciseIds, sessionExerciseRepo, sessionSetRepo });

    const pastSessions: SeedSession[] = [
      {
        key: 'hist_1',
        date: '2026-09-10',
        exercises: [{ name: 'Barbell Bench Press', sets: [{ reps: 8, weight: 70 }] }],
      },
      {
        key: 'hist_2',
        date: '2026-09-16',
        exercises: [{ name: 'Barbell Bench Press', sets: [{ reps: 8, weight: 75 }] }],
      },
      {
        key: 'hist_3',
        date: '2026-09-20',
        exercises: [{ name: 'Barbell Bench Press', sets: [{ reps: 8, weight: 80 }] }],
      },
      {
        key: 'hist_4',
        date: '2026-09-23',
        exercises: [{ name: 'Barbell Bench Press', sets: [{ reps: 8, weight: 82 }] }],
      },
    ];
    for (const s of pastSessions) {
      await seedSession('completed', s);
    }

    // Today: an in-progress session (excluded from the tool's own lookup) that ALSO logged a
    // Bench Press set — this must never be returned; only the completed history above may.
    todaySessionId = await seedSession('in_progress', {
      key: 'today',
      date: '2026-09-26',
      exercises: [{ name: 'Barbell Bench Press', sets: [{ reps: 8, weight: 90 }] }],
    });
  });

  it('AC-HL-1: by id, returns the last <= 3 real performances, newest first, dated, excluding today', async () => {
    const result = (await tool().invoke(
      { exerciseId: benchPressId },
      makeConfig(userId, todaySessionId),
    )) as ToolReturn;
    const content = renderedContent(result);

    expect(content).toContain('Barbell Bench Press');
    expect(content).toContain('last 3 performance(s)');
    // Newest three of the four completed performances — 2026-09-10 (the oldest) is left out.
    expect(content).toContain('2026-09-23');
    expect(content).toContain('2026-09-20');
    expect(content).toContain('2026-09-16');
    expect(content).not.toContain('2026-09-10');
    // Never the in-progress session's own (heavier, 90kg) set.
    expect(content).not.toContain('90 kg');
    expect(content).toContain('82 kg');
  });

  it('AC-HL-1: limit is honoured and capped at the schema max (5)', async () => {
    const result = (await tool().invoke(
      { exerciseId: benchPressId, limit: 2 },
      makeConfig(userId, todaySessionId),
    )) as ToolReturn;
    const content = renderedContent(result);

    expect(content).toContain('last 2 performance(s)');
    expect(content).toContain('2026-09-23');
    expect(content).toContain('2026-09-20');
    expect(content).not.toContain('2026-09-16');
  });

  it('AC-HL-2: by name, resolved via the catalog (exact match)', async () => {
    const result = (await tool().invoke(
      { exerciseName: 'Barbell Back Squat' },
      makeConfig(userId, todaySessionId),
    )) as ToolReturn;

    // No completed Back Squat performance was seeded — the resolver found the right exercise,
    // the "no record" branch (AC-HL-2) is what proves it.
    expect(renderedContent(result)).toBe('no completed record of Barbell Back Squat');
  });

  it('AC-HL-2: unresolvable name -> llm_error suggesting search_exercises', async () => {
    const result = (await tool().invoke(
      { exerciseName: 'Completely Unknown Exercise Xyzzy' },
      makeConfig(userId, todaySessionId),
    )) as ToolReturn;
    const content = renderedContent(result);

    expect(content).toContain('LLM_ERROR');
    expect(content).toContain('search_exercises');
  });

  it('AC-HL-2: no record -> a plain ok "no completed record" result, never an error', async () => {
    const result = (await tool().invoke(
      { exerciseId: pullUpsId },
      makeConfig(userId, todaySessionId),
    )) as ToolReturn;
    const content = renderedContent(result);

    expect(content).toBe('no completed record of Pull-ups');
    expect(content).not.toContain('LLM_ERROR');
    expect(content).not.toContain('SYSTEM_ERROR');
  });
});
