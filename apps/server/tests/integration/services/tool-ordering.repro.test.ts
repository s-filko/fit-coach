/**
 * REPRODUCTION (RED) — AC-LSR-3 / BUG-027. Runs only via an explicit --testMatch (needs the local
 * fitcoach_test database); promoted to a regular integration test when the fix lands.
 *
 * A correction is ONE model response: delete_last_sets for the wrong sets plus a log_set per
 * corrected set — the shape RULE 10 of the training prompt forbids. Real executor, real training
 * policy, real tools, real TrainingService and repositories over the test DB; nothing is stubbed.
 * TRAINING_TOOL_PRIORITY runs log_set (1) before delete_last_sets (3), so the corrected sets are
 * written and delete_last_sets then removes the LAST N sets — the ones just written.
 * Live evidence: runs ef7f3998 (09:32) and a5a49e13 (09:59), 2026-09-21.
 */
import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';

import { TrainingService } from '@domain/training/services/training.service';

import { buildTrainingToolPolicy } from '@infra/ai/graph/phases/training.spec';
import { buildToolExecutor } from '@infra/ai/graph/tool-executor';
import { RunMetricsCollector } from '@infra/ai/run-metrics';
import { buildDeleteLastSetsTool } from '@infra/ai/tools/delete-last-sets.tool';
import { buildLogSetTool } from '@infra/ai/tools/log-set.tool';
import { ExerciseRepository } from '@infra/db/repositories/exercise.repository';
import { SessionExerciseRepository } from '@infra/db/repositories/session-exercise.repository';
import { SessionSetRepository } from '@infra/db/repositories/session-set.repository';
import { DrizzleUserRepository } from '@infra/db/repositories/user.repository';
import { WorkoutPlanRepository } from '@infra/db/repositories/workout-plan.repository';
import { WorkoutSessionRepository } from '@infra/db/repositories/workout-session.repository';

import { createTestUserData } from '../../shared/test-factories';

type Call = { name: string; args: Record<string, unknown>; id: string };

const WRONG_SETS = [
  { reps: 10, weight: 100 },
  { reps: 10, weight: 100 },
];
/** "первых два подхода 110, вторых 2 — 120, по 12, все рпе в конце 9" */
const CORRECTED_SETS = [
  { reps: 12, weight: 110 },
  { reps: 12, weight: 110 },
  { reps: 12, weight: 120 },
  { reps: 12, weight: 120 },
];

describe('correction batch: delete_last_sets + corrected log_set calls (BUG-027)', () => {
  let service: TrainingService;
  let sessionRepo: WorkoutSessionRepository;
  let benchPressId: string;
  let userRepo: DrizzleUserRepository;
  let run: (sessionId: string, calls: Call[]) => Promise<void>;

  beforeAll(async () => {
    userRepo = new DrizzleUserRepository();
    const exerciseRepo = new ExerciseRepository();
    sessionRepo = new WorkoutSessionRepository();
    service = new TrainingService(
      new WorkoutPlanRepository(),
      sessionRepo,
      exerciseRepo,
      new SessionExerciseRepository(),
      new SessionSetRepository(),
      userRepo,
    );

    const bench = (await exerciseRepo.findAll()).find(e => e.name === 'Barbell Bench Press');
    if (!bench) {
      throw new Error('Seed exercise not found — run with RUN_DB_TESTS=1 against an initialised fitcoach_test');
    }
    benchPressId = bench.id;

    const tools = [
      buildLogSetTool({ trainingService: service }),
      buildDeleteLastSetsTool({ trainingService: service }),
    ];
    const executor = buildToolExecutor(
      tools as unknown as StructuredToolInterface[],
      buildTrainingToolPolicy(tools as never),
    );
    const config = {
      configurable: { thread_id: 't-1' },
      metadata: { runId: 'run-1' },
      context: {
        runId: 'run-1',
        userId: 'user-1',
        user: { languageCode: null },
        now: new Date(),
        client: 'telegram',
        trigger: 'user_message',
        metrics: new RunMetricsCollector('run-1'),
      },
    } as unknown as RunnableConfig;

    run = async (sessionId, calls) => {
      await executor(
        { messages: [new AIMessage({ content: '', tool_calls: calls })], activeSessionId: sessionId },
        config,
      );
    };
  });

  /** A fresh user + session already holding the two wrong sets. */
  const seedSessionWithWrongSets = async (label: string): Promise<string> => {
    const user = await userRepo.create(createTestUserData({ username: `ord_repro_${label}_${Date.now()}` }));
    const session = await service.startSession(user.id, {});
    for (const s of WRONG_SETS) {
      await service.logSetWithContext(session.id, {
        exerciseId: benchPressId,
        setData: { type: 'strength', reps: s.reps, weight: s.weight, weightUnit: 'kg' },
        rpe: 8,
      });
    }
    return session.id;
  };

  const storedSets = async (sessionId: string): Promise<Array<{ reps: number; weight: number }>> => {
    const details = await service.getSessionDetails(sessionId);
    const exercise = details!.exercises.find(e => e.exerciseId === benchPressId)!;
    return exercise.sets
      .slice()
      .sort((a, b) => a.setNumber - b.setNumber)
      .map(s => {
        const d = s.setData as { reps: number; weight: number };
        return { reps: d.reps, weight: d.weight };
      });
  };

  const deleteCall = (): Call => ({
    name: 'delete_last_sets',
    args: { exercise_id: benchPressId, count: 2 },
    id: 'del',
  });
  const logCalls = (): Call[] =>
    CORRECTED_SETS.map((s, i) => ({
      name: 'log_set',
      args: { exerciseId: benchPressId, reps: s.reps, weight: s.weight, rpe: 9, order: i + 1 },
      id: `set-${i + 1}`,
    }));

  it('control: the same deletion and the same log_set calls, sent as two batches in that order, leave exactly the corrected sets', async () => {
    const sessionId = await seedSessionWithWrongSets('control');

    await run(sessionId, [deleteCall()]);
    await run(sessionId, logCalls());

    expect(await storedSets(sessionId)).toEqual(CORRECTED_SETS);
  });

  it('one batch [delete_last_sets, 4 x log_set] leaves exactly the corrected sets', async () => {
    const sessionId = await seedSessionWithWrongSets('one_batch');

    await run(sessionId, [deleteCall(), ...logCalls()]);

    expect(await storedSets(sessionId)).toEqual(CORRECTED_SETS);
  });
});
