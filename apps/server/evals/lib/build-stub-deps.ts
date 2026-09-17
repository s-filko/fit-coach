import { randomUUID } from 'node:crypto';

import { MemorySaver } from '@langchain/langgraph';

import type { ChatMsg } from '@domain/ai/types';
import type { ConversationRunRecord } from '@domain/conversation/ports';

import type { ConversationGraphDeps } from '@infra/ai/graph/conversation.graph';

import type { EvalFixture } from '../schema/case.schema';

export interface StubWorld {
  deps: ConversationGraphDeps;
  recordedRuns: ConversationRunRecord[];
}

/**
 * The exercise-catalog UUIDs the stub session plan references. Hoisted so
 * `exerciseRepository.findByIds` can resolve them — start_training_session
 * validates every exerciseId against the catalog (session-planning.tools.ts)
 * and rejects unknown ids with LLM_ERROR, so a session-start case (SPT-0001)
 * needs a catalog that actually contains the proposed exercises.
 */
const CATALOG: ReadonlyMap<string, string> = new Map<string, string>([
  ['11111111-1111-4111-8111-111111111111', 'Жим лёжа (штанга)'],
  ['22222222-2222-4222-8222-222222222222', 'Тяга штанги в наклоне'],
  ['33333333-3333-4333-8333-333333333333', 'Жим гантелей сидя'],
]);

/** Flat set record inside the stub session (what log_set appends). */
interface StubSet {
  id: string;
  setNumber: number;
  rpe: number | null;
  userFeedback: string | null;
  createdAt: Date;
  setData: { type: string; reps?: number; weight?: number; weightUnit?: string; distance?: number; duration?: number };
}

interface StubSessionExercise {
  id: string;
  exerciseId: string;
  name: string;
  status: 'in_progress' | 'completed' | 'skipped';
  targetSets: number;
  targetReps: string;
  targetWeight: number | null;
  sets: StubSet[];
}

/**
 * The minimal `WorkoutSessionWithDetails` the training subgraph actually reads.
 *
 * Why not the raw `fixture.activeSession`: the datasets carry only
 * `{id, sessionKey}` — the session shape is incidental to what a case asserts.
 * But the training prompt builder dereferences `session.exercises.map(...)`
 * (training.node.ts buildWorkoutOverview) and the router checks `status`,
 * so a bare `{id}` object throws before the model is ever reached. The stub
 * world fills in a realistic mid-workout "Upper A" session; fixture keys win.
 */
function buildTrainingSession(fixtureSession: unknown): Record<string, unknown> {
  const startedAt = new Date();
  const bench = '11111111-1111-4111-8111-111111111111';
  const row = '22222222-2222-4222-8222-222222222222';
  const press = '33333333-3333-4333-8333-333333333333';
  const exercises: StubSessionExercise[] = [
    {
      id: 'se-1',
      exerciseId: bench,
      name: 'Жим лёжа (штанга)',
      status: 'in_progress',
      targetSets: 4,
      targetReps: '8',
      targetWeight: 80,
      sets: [
        {
          id: 'set-1',
          setNumber: 1,
          rpe: 7,
          userFeedback: null,
          createdAt: startedAt,
          setData: { type: 'strength', reps: 8, weight: 80, weightUnit: 'kg' },
        },
      ],
    },
  ];
  return {
    id: 'session-1',
    userId: '22222222-2222-4222-8222-222222222222',
    planId: 'plan-1',
    sessionKey: 'Upper A',
    status: 'in_progress',
    startedAt,
    completedAt: null,
    durationMinutes: null,
    userContextJson: null,
    sessionPlanJson: {
      sessionKey: 'Upper A',
      sessionName: 'Upper A',
      reasoning: 'Strength focus, upper body.',
      estimatedDuration: 60,
      exercises: [
        {
          exerciseId: bench,
          exerciseName: 'Жим лёжа (штанга)',
          targetSets: 4,
          targetReps: '8',
          targetWeight: 80,
          restSeconds: 180,
        },
        {
          exerciseId: row,
          exerciseName: 'Тяга штанги в наклоне',
          targetSets: 4,
          targetReps: '8',
          targetWeight: 70,
          restSeconds: 180,
        },
        {
          exerciseId: press,
          exerciseName: 'Жим гантелей сидя',
          targetSets: 3,
          targetReps: '10',
          targetWeight: 40,
          restSeconds: 120,
        },
      ],
    },
    lastActivityAt: startedAt,
    autoCloseReason: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    // view shape consumed by buildWorkoutOverview: exercise.name, sets, status
    exercises: exercises.map(ex => ({
      ...ex,
      exercise: { id: ex.exerciseId, name: ex.name },
      orderIndex: exercises.indexOf(ex) + 1,
      sessionId: 'session-1',
      targetWeight: ex.targetWeight !== null ? String(ex.targetWeight) : null,
    })),
    ...(typeof fixtureSession === 'object' && fixtureSession !== null ? fixtureSession : {}),
  };
}

/** `session.exercises` narrowed back to the mutable stub shape. */
function stubExercises(
  session: Record<string, unknown> | null,
): Array<StubSessionExercise & { exercise: { id: string; name: string } }> {
  if (!session) {
    throw new Error('No active training session in the stub world');
  }
  return session['exercises'] as Array<StubSessionExercise & { exercise: { id: string; name: string } }>;
}

export function buildStubDeps(fixture: EvalFixture, messages?: Array<{ role: string; text: string }>): StubWorld {
  const recordedRuns: ConversationRunRecord[] = [];
  const userId = '22222222-2222-4222-8222-222222222222';

  // Episode seed: the case's state.messages stand in for what production's
  // context service would return from persisted turns. `human → user`,
  // `ai → assistant`; tool_call/tool_result cannot be expressed as ChatMsg
  // pre-P4 (the production context service stores user/assistant turns only)
  // and are skipped, not thrown on.
  const seededHistory: ChatMsg[] = (messages ?? [])
    .filter((m): m is { role: 'human' | 'ai'; text: string } => m.role === 'human' || m.role === 'ai')
    .map(m => ({ role: m.role === 'human' ? 'user' : 'assistant', content: m.text }));

  const user = { id: userId, ...fixture.user };
  const activePlan = fixture.hasActivePlan
    ? ({ id: 'plan-1', name: 'Test plan', ...((fixture.plan as Record<string, unknown>) ?? {}) } as {
        id: string;
        name: string;
      })
    : null;
  // Chat fixtures carry no activeSession — production would return null there,
  // and a synthetic in-progress session would change what the chat prompt sees.
  const session = fixture.activeSession ? buildTrainingSession(fixture.activeSession) : null;

  const deps = {
    // IUserService — the port's method is getUser(id), not getUserById.
    // Verified against src/domain/user/ports/service.ports.ts:5-11.
    userService: {
      upsertUser: async () => user,
      getUser: async () => user,
      updateProfileData: async () => user,
      isRegistrationComplete: () => fixture.user.registrationCompleted === true,
      needsRegistration: () => fixture.user.registrationCompleted !== true,
    },
    // ITrainingService — the router calls getSessionDetails on every training-phase run
    // (router.node.ts:47) and the training subgraph calls it again (training.subgraph.ts:326).
    // An empty object here throws before the model is ever reached.
    // The mutation methods back the training tools so log_set/finish_training behave
    // like production instead of erroring into the LLM_ERROR retry budget.
    trainingService: {
      getSessionDetails: async () => session,
      getActiveSession: async () => session,
      getActivePlan: async () => activePlan,
      getTrainingHistory: async () => fixture.sessions ?? [],
      // start_training_session (session-planning.tools.ts) resolves the active plan,
      // creates the session and returns it; only `session.id` is read afterwards
      // (propagated as activeSessionId). A fresh id so a started run never
      // collides with the seeded mid-workout 'session-1'.
      startSession: async () => ({
        id: 'session-2',
        userId,
        planId: activePlan?.id ?? null,
        sessionKey: 'Upper A',
        status: 'in_progress',
        exercises: [],
      }),
      logSetWithContext: async (
        _sessionId: string,
        opts: {
          exerciseId?: string;
          exerciseName?: string;
          setData: StubSet['setData'];
          rpe?: number;
          feedback?: string;
        },
      ) => {
        const exs = stubExercises(session);
        let current = exs.find(ex => ex.status === 'in_progress');
        let autoCompleted: ReturnType<typeof summarize> | undefined;

        const wanted =
          exs.find(ex => ex.exerciseId === opts.exerciseId) ?? exs.find(ex => ex.name === opts.exerciseName);
        if (wanted && current && wanted !== current) {
          autoCompleted = summarize(current);
          current.status = 'completed';
          current = wanted;
        }
        if (!current) {
          const plan = session!['sessionPlanJson'] as {
            exercises: Array<{ exerciseId: string; exerciseName?: string }>;
          };
          const next = plan.exercises.find(p => !exs.some(ex => ex.exerciseId === p.exerciseId));
          if (!opts.exerciseId && !opts.exerciseName) {
            throw new Error('No active exercise and no exercise reference in log_set call');
          }
          const fresh: StubSessionExercise & { exercise: { id: string; name: string } } = {
            id: randomUUID(),
            exerciseId: opts.exerciseId ?? randomUUID(),
            name: opts.exerciseName ?? next?.exerciseName ?? 'Exercise',
            status: 'in_progress',
            targetSets: 3,
            targetReps: '8-10',
            targetWeight: null,
            sets: [],
            exercise: {
              id: opts.exerciseId ?? randomUUID(),
              name: opts.exerciseName ?? next?.exerciseName ?? 'Exercise',
            },
          };
          exs.push(fresh);
          current = fresh;
        }

        const set: StubSet = {
          id: randomUUID(),
          setNumber: current.sets.length + 1,
          rpe: opts.rpe ?? null,
          userFeedback: opts.feedback ?? null,
          createdAt: new Date(),
          setData: opts.setData,
        };
        current.sets.push(set);
        session!['lastActivityAt'] = new Date();
        return {
          set: { ...set, sessionExerciseId: current.id, completedAt: null },
          setNumber: set.setNumber,
          autoCompleted,
        };
      },
      completeCurrentExercise: async () => {
        const current = stubExercises(session).find(ex => ex.status === 'in_progress');
        if (!current) {
          throw new Error('No exercise in progress');
        }
        current.status = 'completed';
        return summarize(current);
      },
      completeSession: async () => {
        if (!session) {
          throw new Error('No active training session in the stub world');
        }
        session['status'] = 'completed';
        session['completedAt'] = new Date();
        session['durationMinutes'] = 45;
        return session;
      },
      deleteLastSets: async (_sessionId: string, exerciseId: string, count = 1) => {
        const ex = stubExercises(session).find(e => e.exerciseId === exerciseId);
        if (!ex) {
          throw new Error(`Exercise ${exerciseId} not found in session`);
        }
        const deleted = ex.sets.splice(-count);
        return {
          exerciseId,
          deletedSets: deleted.map(s => ({ setNumber: s.setNumber, setData: s.setData, rpe: s.rpe })),
        };
      },
      updateLastSet: async (
        _sessionId: string,
        exerciseId: string,
        updates: { rpe?: number; feedback?: string; weight?: number; reps?: number },
      ) => {
        const ex = stubExercises(session).find(e => e.exerciseId === exerciseId);
        const last = ex ? ex.sets[ex.sets.length - 1] : undefined;
        if (!ex || !last) {
          throw new Error(`No logged sets for exercise ${exerciseId}`);
        }
        const before = { setData: { ...last.setData }, rpe: last.rpe, userFeedback: last.userFeedback };
        if (updates.weight !== undefined) {
          last.setData.weight = updates.weight;
        }
        if (updates.reps !== undefined) {
          last.setData.reps = updates.reps;
        }
        if (updates.rpe !== undefined) {
          last.rpe = updates.rpe;
        }
        if (updates.feedback !== undefined) {
          last.userFeedback = updates.feedback;
        }
        return {
          exerciseId,
          setNumber: last.setNumber,
          before,
          after: { setData: { ...last.setData }, rpe: last.rpe, userFeedback: last.userFeedback },
        };
      },
    },
    workoutPlanRepo: {
      // Real method name — chat.subgraph.ts:57, session-planning builder.
      findActiveByUserId: async () => activePlan,
    },
    workoutSessionRepo: {
      // Real names — chat.subgraph.ts:58, training.subgraph.ts:338.
      findRecentByUserIdWithDetails: async () => fixture.sessions ?? [],
      findRecentByUserId: async () => fixture.sessions ?? [],
      findLastCompletedByUserAndKey: async () => null,
    },
    exerciseRepository: {
      searchByEmbedding: async () => [],
      // Resolves the catalog UUIDs the stub plan proposes — see CATALOG above.
      findByIds: async (ids: string[] = []) => ids.map(id => ({ id, name: CATALOG.get(id) ?? 'Exercise' })),
    },
    embeddingService: {
      embed: async () => new Array(1536).fill(0),
    },
    contextService: {
      appendTurn: async () => undefined,
      getMessagesForPrompt: async () => seededHistory,
      insertContextReset: async () => undefined,
      insertPhaseSummary: async () => undefined,
      getLatestSummary: async () => null,
      getLastUserMessageTime: async () => null,
    },
    runService: {
      recordRun: async (record: ConversationRunRecord) => {
        recordedRuns.push(record);
      },
    },
    checkpointer: new MemorySaver(),
  } as unknown as ConversationGraphDeps;

  return { deps, recordedRuns };
}

/** AutoCompletedExercise shape — service.ports.ts:33. */
function summarize(ex: StubSessionExercise) {
  return {
    exerciseId: ex.exerciseId,
    exerciseName: ex.name,
    setsLogged: ex.sets.length,
    sets: ex.sets.map(s => ({
      setNumber: s.setNumber,
      reps: s.setData.reps ?? undefined,
      weight: s.setData.weight ?? undefined,
      weightUnit: s.setData.weightUnit ?? undefined,
      rpe: s.rpe,
    })),
    targetSets: ex.targetSets,
    targetReps: ex.targetReps,
    targetWeight: ex.targetWeight !== null ? String(ex.targetWeight) : null,
  };
}
