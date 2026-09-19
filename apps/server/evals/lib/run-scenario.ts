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
import { eq } from 'drizzle-orm';

import type { ConversationPhase } from '@domain/conversation/phases';
import { type ConversationRunPort, CONVERSATION_RUN_PORT_TOKEN } from '@domain/conversation/ports';
import { type IWorkoutSessionRepository, WORKOUT_SESSION_REPOSITORY_TOKEN } from '@domain/training/ports';
import type { WorkoutSessionWithDetails } from '@domain/training/types';
import type { CompiledConversationGraph } from '@infra/ai/graph/conversation.graph';
import { db } from '@infra/db/drizzle';
import { conversationRuns } from '@infra/db/schema';
import { Container } from '@infra/di/container';
import { registerInfraServices } from '@main/register-infra-services';

import { resolveRelativeTime, type Scenario } from '../schema/scenario.schema';

import { assertScenarioTestDatabase } from './scenario-db-guard';
import { seedCheckpointState, seedScenarioRows } from './scenario-world';

/** The `conversation_runs` row of one step's run, reduced to what journeys assert on. */
export interface ScenarioRunRow {
  runId: string;
  phaseIn: string;
  phaseOut: string | null;
  outcome: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }> | null;
  transition: { toPhase: string } | null;
}

/** Everything observed about one scenario step. */
export interface ScenarioStepObservation {
  stepIndex: number;
  action: 'advance' | 'user';
  /** Delivered text (final AI message of the run); '' on advance steps. */
  delivered: string;
  runRow: ScenarioRunRow | null;
  /** Checkpointed phase after the step (`graph.getState`). */
  phase: ConversationPhase;
  /** DB snapshot: the user's sessions, newest first. */
  sessions: WorkoutSessionWithDetails[];
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
  await registerInfraServices(container);
  // Dynamic on purpose: the deterministic layer installs a jest mock of
  // `@infra/ai/model.factory` before this module graph is ever required, and a
  // static import of conversation.graph here would load it too early.
  const { CONVERSATION_GRAPH_TOKEN } = await import('@infra/ai/graph/conversation.graph');
  const graph = container.get<CompiledConversationGraph>(CONVERSATION_GRAPH_TOKEN);
  const runPort = container.get<ConversationRunPort>(CONVERSATION_RUN_PORT_TOKEN);
  const sessionRepo = container.get<IWorkoutSessionRepository>(WORKOUT_SESSION_REPOSITORY_TOKEN);

  const t0 = new Date();
  const world = await seedScenarioRows(scenario.past, t0);
  await seedCheckpointState(graph, { userId: world.userId, past: scenario.past, t0 });

  const steps: ScenarioStepObservation[] = [];
  for (const [stepIndex, step] of scenario.steps.entries()) {
    if (step.action === 'advance') {
      opts.onAdvance?.(resolveRelativeTime(step.at, t0));
      steps.push({
        stepIndex,
        action: 'advance',
        delivered: '',
        runRow: null,
        phase: await currentPhase(graph, world.userId),
        sessions: await sessionRepo.findRecentByUserIdWithDetails(world.userId, 10),
      });
      continue;
    }

    const result = await runPort.run({ userId: world.userId, text: step.text });
    steps.push({
      stepIndex,
      action: 'user',
      delivered: result.text,
      runRow: await loadRunRow(result.runId),
      phase: await currentPhase(graph, world.userId),
      sessions: await sessionRepo.findRecentByUserIdWithDetails(world.userId, 10),
    });
  }

  return { userId: world.userId, planId: world.planId, t0, steps };
}

async function currentPhase(graph: CompiledConversationGraph, userId: string): Promise<ConversationPhase> {
  const state = await graph.getState({ configurable: { thread_id: userId } });
  return state.values.phase;
}
