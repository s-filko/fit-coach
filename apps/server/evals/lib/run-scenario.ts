/**
 * The scenario runner (training-journey-scenarios plan, Task 2 / AC-TJ-2) —
 * one runner for both layers. It wires the REAL production stack
 * (`registerInfraServices(new Container())`: repositories, gateway,
 * PostgresSaver checkpointer, mutex-wrapped run port), seeds the scenario's
 * world as real rows plus a checkpoint, then drives each `user` step through
 * `ConversationRunPort.run` and observes three planes per step: the delivered
 * text, the `conversation_runs` row, and a DB snapshot of the user's
 * sessions, alongside the checkpointed phase (`graph.getState`).
 *
 * What the model SAW is not observed here — only the deterministic layer can
 * know it, via the scripted model's recording (tests/integration/scenarios/
 * scripted-model.ts); the live L3 layer skips `seen` by design.
 *
 * Clock: the runner reads T0 from `new Date()` once. On `advance` steps it
 * calls the optional `onAdvance` hook with the resolved time — the
 * deterministic layer points it at `jest.setSystemTime` (Date-only fake
 * timers), so `ctx.now` AND the wall-clock reads follow the scenario clock;
 * the live layer simply gets real time.
 *
 * Hard guard: refuses to start unless DB_NAME ends in `_test`
 * (scenario-db-guard.ts — Test-DB safety, 2026-09-20).
 */
import { desc, eq, inArray } from 'drizzle-orm';

import type { ConversationPhase } from '@domain/conversation/phases';
import { type ConversationRunPort, CONVERSATION_RUN_PORT_TOKEN } from '@domain/conversation/ports';
import {
  type IEmbeddingService,
  type IWorkoutSessionRepository,
  WORKOUT_SESSION_REPOSITORY_TOKEN,
} from '@domain/training/ports';
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import type { CompiledConversationGraph } from '@infra/ai/graph/conversation.graph';
import { db } from '@infra/db/drizzle';
import { conversationRuns, conversationTurns, userFacts, workoutPlans, workoutSessions } from '@infra/db/schema';
import { Container } from '@infra/di/container';
import { registerInfraServices } from '@main/register-infra-services';

import { resolveRelativeTime, type Scenario } from '../schema/scenario.schema';

import { assertScenarioTestDatabase } from './scenario-db-guard';
import { type FactRowSnapshot, type PlanRowSnapshot } from './persisted-expectations';
import { seedCheckpointState, seedScenarioRows } from './scenario-world';

/** The `conversation_runs` row of one step's run, reduced to what journeys assert on. */
export interface ScenarioRunRow {
  runId: string;
  phaseIn: string;
  phaseOut: string | null;
  outcome: string;
  /** The commit node records a hash of the args, never the args themselves. */
  toolCalls: Array<{ name: string; argsHash: string; outcomeKind: string }> | null;
  transition: { toPhase: string } | null;
}

/** Everything observed about one scenario step. */
export interface ScenarioStepObservation {
  stepIndex: number;
  action: 'advance' | 'user';
  /** Delivered text (final AI message of the run); '' on advance steps. */
  delivered: string;
  runRow: ScenarioRunRow | null;
  /** `conversation_turns` rows linked to this step's run; 0 on advance steps. */
  turnCount: number;
  /** Checkpointed phase after the step (`graph.getState`). */
  phase: ConversationPhase;
  /** DB snapshot: the user's sessions, newest first. */
  sessions: WorkoutSessionWithDetails[];
  /** DB snapshot: every `user_facts` row of the user (archived included) — the AC-FL-7 evidence plane. */
  facts: FactRowSnapshot[];
  /** DB snapshot: the user's `workout_plans` rows, newest first. */
  plans: PlanRowSnapshot[];
}

export interface ScenarioRunResult {
  userId: string;
  planId: string | null;
  t0: Date;
  steps: ScenarioStepObservation[];
}

export interface RunScenarioOptions {
  container?: Container;
  /**
   * Called with the resolved time on every `advance` step (never for user
   * steps). The deterministic layer wires it to `jest.setSystemTime`.
   */
  onAdvance?: (now: Date) => void;
  /**
   * The course-check switch (AC-FL-7): 'on' / 'off' overrides
   * COURSE_CHECK_ENABLED for THIS run's wiring; absent = whatever the
   * environment says (how the owner's live L3 runs pick it up). The graph
   * reads the flag once, at composition, so it is restored right after wiring.
   */
  courseCheck?: 'on' | 'off';
  /** Called once the world is seeded, before the first step — the user id journeys resolve placeholders against. */
  onSeeded?: (world: { userId: string; planId: string | null; t0: Date }) => void;
  /** Called at the start of every step (advance or user), before it runs — per-step scripts queue here. */
  onStepStart?: (stepIndex: number) => void;
  /**
   * Embeds any scenario-seeded exercise still missing a vector. Left
   * undefined, no embedding is computed at all (today's Jest behaviour —
   * the real ONNX pipeline crashes inside Jest's runtime, see
   * `embed-pending-exercises.ts`). Only the live L3 CLI path passes one.
   */
  embeddingService?: IEmbeddingService;
  /**
   * Called with each step's observation right after the step completes,
   * before the next step starts. The deterministic layer drains the scripted
   * model's recorded inputs here — a multi-step journey cannot attribute
   * them to steps after the run is over.
   */
  onStep?: (observation: ScenarioStepObservation) => void;
}

async function loadRunRow(runId: string): Promise<ScenarioRunRow | null> {
  const [row] = await db
    .select({
      runId: conversationRuns.runId,
      phaseIn: conversationRuns.phaseIn,
      phaseOut: conversationRuns.phaseOut,
      outcome: conversationRuns.outcome,
      toolCalls: conversationRuns.toolCalls,
      transition: conversationRuns.transition,
    })
    .from(conversationRuns)
    .where(eq(conversationRuns.runId, runId));
  if (!row) {
    return null;
  }
  return {
    runId: row.runId,
    phaseIn: row.phaseIn,
    phaseOut: row.phaseOut,
    outcome: row.outcome,
    toolCalls: (row.toolCalls as ScenarioRunRow['toolCalls']) ?? null,
    transition: (row.transition as ScenarioRunRow['transition']) ?? null,
  };
}

/**
 * Runs one scenario end to end over the real test database. The `_test` guard
 * fires before anything is wired or seeded.
 */
export async function runScenario(scenario: Scenario, opts: RunScenarioOptions = {}): Promise<ScenarioRunResult> {
  assertScenarioTestDatabase(process.env.DB_NAME);

  const container = opts.container ?? new Container();
  const previousSwitch = process.env.COURSE_CHECK_ENABLED;
  if (opts.courseCheck !== undefined) {
    process.env.COURSE_CHECK_ENABLED = opts.courseCheck === 'off' ? 'false' : 'true';
  }
  try {
    await registerInfraServices(container);
  } finally {
    if (opts.courseCheck !== undefined) {
      if (previousSwitch === undefined) {
        delete process.env.COURSE_CHECK_ENABLED;
      } else {
        process.env.COURSE_CHECK_ENABLED = previousSwitch;
      }
    }
  }
  // Dynamic on purpose: the deterministic layer installs a jest mock of
  // `@infra/ai/model.factory` before this module graph is ever required, and a
  // static import of conversation.graph here would load it too early.
  const { CONVERSATION_GRAPH_TOKEN } = await import('@infra/ai/graph/conversation.graph');
  const graph = container.get<CompiledConversationGraph>(CONVERSATION_GRAPH_TOKEN);
  const runPort = container.get<ConversationRunPort>(CONVERSATION_RUN_PORT_TOKEN);
  const sessionRepo = container.get<IWorkoutSessionRepository>(WORKOUT_SESSION_REPOSITORY_TOKEN);

  const t0 = new Date();
  const world = await seedScenarioRows(scenario.past, t0, opts.embeddingService);
  await seedCheckpointState(graph, { userId: world.userId, past: scenario.past, t0 });
  opts.onSeeded?.({ userId: world.userId, planId: world.planId, t0 });

  // Sessions created mid-journey (start_training_session) get their creation
  // `last_activity_at`/`created_at` from the DB clock (defaultNow), which is
  // REAL time while the journey runs on the scenario clock — the first
  // log_set would then look hours stale (retro/stale logic) and
  // findRecentByUserIdWithDetails' createdAt ordering would be
  // non-deterministic. Stamping a session's creation stamps to the scenario
  // clock at first sight restores the production invariant (creation moment =
  // activity moment) without touching any later staleness behaviour.
  const clock = { now: t0 };
  const knownSessionIds = new Set((await sessionRepo.findRecentByUserIdWithDetails(world.userId, 10)).map(s => s.id));
  const stampNewSessions = async (): Promise<void> => {
    const fresh = (await sessionRepo.findRecentByUserIdWithDetails(world.userId, 10)).filter(
      s => !knownSessionIds.has(s.id),
    );
    if (fresh.length === 0) {
      return;
    }
    await db
      .update(workoutSessions)
      .set({ lastActivityAt: clock.now, createdAt: clock.now })
      .where(
        inArray(
          workoutSessions.id,
          fresh.map(s => s.id),
        ),
      );
    fresh.forEach(s => knownSessionIds.add(s.id));
  };

  const steps: ScenarioStepObservation[] = [];
  try {
    for (const [stepIndex, step] of scenario.steps.entries()) {
      opts.onStepStart?.(stepIndex);
      if (step.action === 'advance') {
        clock.now = resolveRelativeTime(step.at, t0);
        opts.onAdvance?.(clock.now);
        await stampNewSessions();
        const observation: ScenarioStepObservation = {
          stepIndex,
          action: 'advance',
          delivered: '',
          runRow: null,
          turnCount: 0,
          phase: await currentPhase(graph, world.userId),
          sessions: await sessionRepo.findRecentByUserIdWithDetails(world.userId, 10),
          facts: await loadFactRows(world.userId),
          plans: await loadPlanRows(world.userId),
        };
        steps.push(observation);
        opts.onStep?.(observation);
        continue;
      }

      const result = await runPort.run({ userId: world.userId, text: step.text });
      await stampNewSessions();
      const observation: ScenarioStepObservation = {
        stepIndex,
        action: 'user',
        delivered: result.text,
        runRow: await loadRunRow(result.runId),
        turnCount: await countTurns(result.runId),
        phase: await currentPhase(graph, world.userId),
        sessions: await sessionRepo.findRecentByUserIdWithDetails(world.userId, 10),
        facts: await loadFactRows(world.userId),
        plans: await loadPlanRows(world.userId),
      };
      steps.push(observation);
      opts.onStep?.(observation);
    }
  } finally {
    await releaseCheckpointer(graph);
  }

  return { userId: world.userId, planId: world.planId, t0, steps };
}

/**
 * Every run wires its own PostgresSaver, which owns a pg pool. A journey file
 * that runs the scenario several times (the fact-lifecycle journeys run each
 * one with the course check on AND off), or a test that wires its own extra
 * graph beyond what `runScenario` builds (close-out review Blocking 2), would
 * otherwise leave a pool per run open until the process exits and exhaust the
 * test database's connections ("too many clients already") for every file
 * that follows. Exported so callers driving their own graph/container reuse
 * this instead of copying it.
 */
export async function releaseCheckpointer(graph: CompiledConversationGraph): Promise<void> {
  const checkpointer = (graph as unknown as { checkpointer?: { end?: () => Promise<void> } }).checkpointer;
  await checkpointer?.end?.();
}

/** Every `user_facts` row of the user, archived included — raw rows, never the prompt-filtered read. */
export async function loadFactRows(userId: string): Promise<FactRowSnapshot[]> {
  const rows = await db.select().from(userFacts).where(eq(userFacts.userId, userId));
  return rows.map(r => ({
    id: r.id,
    fact: r.fact,
    status: r.status,
    archivedReason: r.archivedReason,
    closedByUserAt: r.closedByUserAt,
    durability: r.durability,
    onExpiry: r.onExpiry,
    expiresAt: r.expiresAt,
    reviewAfter: r.reviewAfter,
    phaseNote: r.phaseNote,
    confirmations: r.confirmations,
    supersedesId: r.supersedesId,
  }));
}

/** The user's plans newest first; the exercise names come out of plan_json's session templates. */
export async function loadPlanRows(userId: string): Promise<PlanRowSnapshot[]> {
  const rows = await db
    .select()
    .from(workoutPlans)
    .where(eq(workoutPlans.userId, userId))
    .orderBy(desc(workoutPlans.createdAt));
  return rows.map(r => {
    const templates =
      (r.planJson as { sessionTemplates?: Array<{ exercises?: Array<{ exerciseName: string }> }> }).sessionTemplates ??
      [];
    return {
      id: r.id,
      status: r.status,
      exerciseNames: templates.flatMap(t => (t.exercises ?? []).map(e => e.exerciseName)),
    };
  });
}

async function countTurns(runId: string): Promise<number> {
  const turns = await db
    .select({ id: conversationTurns.id })
    .from(conversationTurns)
    .where(eq(conversationTurns.runId, runId));
  return turns.length;
}

async function currentPhase(graph: CompiledConversationGraph, userId: string): Promise<ConversationPhase> {
  const state = await graph.getState({ configurable: { thread_id: userId } });
  return state.values.phase;
}
