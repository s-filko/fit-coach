/**
 * Failure on the hop (transition-handoff plan Task 3, AC-TH-5): with
 * `TRANSITION_HANDOFF_TARGETS=training`, session_planning's
 * `start_training_session` call succeeds and hands off, but the SECOND
 * (training) model call of the same run — right after the hop — throws a
 * provider error. The committed transition must stand (checkpoint phase
 * `training`, session `in_progress`) even though the run itself failed; the
 * failure must record exactly one run row (the looping commit wrote none);
 * and the next message must be served normally by `training`.
 *
 * Real production wiring (registerInfraServices), real graph, adapter,
 * repositories and PostgresSaver; only the ChatModel beneath the gateway is
 * replaced by the shared scripted model (scripted-model.ts).
 */
import { and, desc, eq } from 'drizzle-orm';

import type { ConversationPhase } from '@domain/conversation/phases';
import { CONVERSATION_RUN_PORT_TOKEN, type ConversationRunPort } from '@domain/conversation/ports';
import type { CompiledConversationGraph } from '@infra/ai/graph/conversation.graph';
import { db } from '@infra/db/drizzle';
import { conversationRuns, sessionExercises, sessionSets, workoutSessions } from '@infra/db/schema';
import { Container } from '@infra/di/container';
import { registerInfraServices } from '@main/register-infra-services';

import { runScenario } from '../../../evals/lib/run-scenario';
import { ScenarioSchema, type Scenario } from '../../../evals/schema/scenario.schema';
import { BENCH_PRESS_ID, sharedPast, setupSteps } from '../../../evals/scenarios/b-full-workout.scenario';
import { REAL_TIMER_APIS } from '../../helpers/real-timers';

import { installScriptedModel, type ScriptedModelHandle } from './scripted-model';

/** The scenario's weekday labels in the imported setup steps are pinned to this T0. */
const T0 = new Date('2026-09-20T10:00:00.000Z');

const SET_REPORT = 'сделал 2 подхода 110×12 на жиме ногами';
const FOLLOWUP_TEXT = 'ещё подход 8 на 60';
const FOLLOWUP_CLOSING_TEXT = 'Записал: 60 × 8.';

/** setup only — chat → session_planning → proposal; training NOT started. */
const setupScenario: Scenario = {
  id: 'handoff-failure-setup',
  description: 'setup for the hop-failure test: reaches session_planning',
  past: sharedPast,
  steps: setupSteps.slice(0, 2),
};

async function currentPhase(graph: CompiledConversationGraph, userId: string): Promise<ConversationPhase> {
  const state = await graph.getState({ configurable: { thread_id: userId } });
  return (state.values as { phase: ConversationPhase }).phase;
}

async function runRowCount(userId: string): Promise<number> {
  const rows = await db
    .select({ runId: conversationRuns.runId })
    .from(conversationRuns)
    .where(eq(conversationRuns.userId, userId));
  return rows.length;
}

async function latestRunRow(userId: string) {
  const [row] = await db
    .select()
    .from(conversationRuns)
    .where(eq(conversationRuns.userId, userId))
    .orderBy(desc(conversationRuns.createdAt))
    .limit(1);
  return row ?? null;
}

/** Every stored session_sets row's setData for this user, across all their sessions. */
async function storedSets(userId: string) {
  return db
    .select({ setData: sessionSets.setData })
    .from(sessionSets)
    .innerJoin(sessionExercises, eq(sessionSets.sessionExerciseId, sessionExercises.id))
    .innerJoin(workoutSessions, eq(sessionExercises.sessionId, workoutSessions.id))
    .where(eq(workoutSessions.userId, userId));
}

/** Every stub in this file uses ONE fresh Container/graph — never the one runScenario builds internally for setup. */
async function releaseCheckpointer(graph: CompiledConversationGraph): Promise<void> {
  const checkpointer = (graph as unknown as { checkpointer?: { end?: () => Promise<void> } }).checkpointer;
  await checkpointer?.end?.();
}

describe('U5 transition-handoff — failure on the hop (AC-TH-5)', () => {
  let model: ScriptedModelHandle;
  let userId: string;
  let runPort: ConversationRunPort;
  let graph: CompiledConversationGraph;
  let previousFlag: string | undefined;
  let caughtError: unknown;
  let runRowCountBeforeFailure: number;
  let phaseAfterSetup: ConversationPhase;

  beforeAll(async () => {
    expect(ScenarioSchema.parse({ ...setupScenario, steps: setupSteps.slice(0, 2) })).toBeTruthy();
    previousFlag = process.env.TRANSITION_HANDOFF_TARGETS;
    process.env.TRANSITION_HANDOFF_TARGETS = 'training';
    model = installScriptedModel();
    jest.useFakeTimers({ advanceTimers: true, doNotFake: REAL_TIMER_APIS });
    jest.setSystemTime(T0);

    // 1. Setup, through the shared runner: chat → session_planning → proposal.
    for (const step of setupScenario.steps) {
      if (step.action === 'user') {
        model.enqueueChat(step.script ?? []);
      }
    }
    await runScenario(setupScenario, {
      onSeeded: world => {
        ({ userId } = world);
      },
      onAdvance: now => jest.setSystemTime(now),
    });

    // 2. A SEPARATE wiring for the rest of this test — runScenario releases its
    //    own checkpointer's pool once it returns; the checkpointed thread
    //    (thread_id = userId) is durable in Postgres, so a fresh graph/runPort
    //    picks the SAME conversation up exactly where the setup left it.
    const container = await registerInfraServices(new Container());
    runPort = container.get<ConversationRunPort>(CONVERSATION_RUN_PORT_TOKEN);
    const { CONVERSATION_GRAPH_TOKEN } = await import('@infra/ai/graph/conversation.graph');
    graph = container.get<CompiledConversationGraph>(CONVERSATION_GRAPH_TOKEN);

    phaseAfterSetup = await currentPhase(graph, userId);
    runRowCountBeforeFailure = await runRowCount(userId);

    // 3. The hop: session_planning's call succeeds (start_training_session,
    //    hands off silently); training's call — right after the hop, in the
    //    SAME run — throws a provider error (enqueueChatThrow respects FIFO
    //    order, unlike failNextChat, which would fire on the FIRST call).
    model.enqueueChat([
      {
        toolCall: {
          name: 'start_training_session',
          args: {
            sessionKey: 'upper_a',
            sessionName: 'Upper A',
            reasoning: 'The user is training right now — open the session and log what they already did.',
            exercises: [
              {
                exerciseId: BENCH_PRESS_ID,
                exerciseName: 'Barbell Bench Press',
                targetSets: 3,
                targetReps: '8-10',
                restSeconds: 120,
              },
            ],
            estimatedDuration: 45,
          },
        },
      },
    ]);
    model.enqueueChatThrow(Object.assign(new Error('provider outage on the training hop'), { status: 503 }));

    try {
      await runPort.run({ userId, text: SET_REPORT });
    } catch (err) {
      caughtError = err;
    }
  });

  afterAll(async () => {
    jest.useRealTimers();
    await releaseCheckpointer(graph);
    if (previousFlag === undefined) {
      delete process.env.TRANSITION_HANDOFF_TARGETS;
    } else {
      process.env.TRANSITION_HANDOFF_TARGETS = previousFlag;
    }
  });

  it('control: the setup reaches session_planning before the hop is attempted', () => {
    expect(phaseAfterSetup).toBe('session_planning');
  });

  it('the run fails with the typed error the bot maps to its standard "unavailable" text (LLM_UNAVAILABLE) — never a set confirmation', () => {
    expect(caughtError).toBeDefined();
    expect((caughtError as { code?: string } | undefined)?.code).toBe('LLM_UNAVAILABLE');
    expect(String((caughtError as Error).message)).not.toMatch(/записал|logged|saved/i);
  });

  it('AC-TH-5: nothing from the planning hop was persisted — the reported set is NOT stored', async () => {
    const sets = await storedSets(userId);
    expect(sets.map(s => s.setData)).not.toContainEqual(expect.objectContaining({ reps: 12, weight: 110 }));
  });

  it('AC-TH-5: exactly ONE run row is written for the failed run (the looping commit wrote none, no duplicate-runId crash)', async () => {
    expect(await runRowCount(userId)).toBe(runRowCountBeforeFailure + 1);

    const row = await latestRunRow(userId);
    expect(row?.outcome).toBe('llm_unavailable');
    expect(row?.errorClass).toBe('Error');
    expect(row?.errorMessage).toBe('provider outage on the training hop');
    // The adapter reads the phase BEFORE the run — the phase the hop started from.
    expect(row?.phaseIn).toBe('session_planning');
    expect(row?.phaseOut).toBeNull();
  });

  it('AC-TH-5: the committed transition stands — checkpoint phase training, session in_progress, activeSessionId set', async () => {
    const state = await graph.getState({ configurable: { thread_id: userId } });
    const values = state.values as { phase: ConversationPhase; activeSessionId: string | null };
    expect(values.phase).toBe('training');
    expect(values.activeSessionId).toBeTruthy();

    const [session] = await db
      .select({ status: workoutSessions.status })
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, userId))
      .orderBy(desc(workoutSessions.createdAt))
      .limit(1);
    expect(session?.status).toBe('in_progress');
  });

  it('AC-TH-5: the next message is served by training, and its log_set is stored — no leaked hop context', async () => {
    model.enqueueChat([
      { toolCall: { name: 'log_set', args: { exerciseId: BENCH_PRESS_ID, reps: 8, weight: 60 } } },
      { text: FOLLOWUP_CLOSING_TEXT },
    ]);

    const result = await runPort.run({ userId, text: FOLLOWUP_TEXT });

    expect(result.text).toBe(FOLLOWUP_CLOSING_TEXT);
    expect(result.phase).toBe('training');

    const sets = await storedSets(userId);
    expect(sets.map(s => s.setData)).toContainEqual(expect.objectContaining({ reps: 8, weight: 60 }));

    // No leaked hop context from the failed run: this run committed no
    // transition of its own, so its row's `transition` is plain null.
    const row = await latestRunRow(userId);
    expect(row?.runId).toBe(result.runId);
    expect(row?.outcome).toBe('ok');
    expect(row?.phaseIn).toBe('training');
    expect(row?.phaseOut).toBeNull();
    expect(row?.transition).toBeNull();
  });
});
