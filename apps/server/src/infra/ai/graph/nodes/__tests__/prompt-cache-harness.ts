/**
 * Shared harness for the prompt-caching request tests (AC-PC-1..5): the agent node over a training-shaped fake
 * phase with the real training tool policy, a real ChatOpenAI with a capturing `fetch` (request-capture.ts).
 * The test files register the `jest.mock` calls (model.factory → `state.model`, @config/index → `state.config`).
 */
import { AIMessage, type BaseMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { computeLoadFacts } from '@domain/training/load-facts';
import { LEG_PRESS_ROWS, ownerNow } from '@domain/training/load-facts/__tests__/fixtures';
import { defaultProgression } from '@domain/training/load-plan';

import { buildAgentNode } from '@infra/ai/graph/nodes/agent.node';
import type { ConversationGraphDeps, PhaseSpec } from '@infra/ai/graph/phase-spec';
import { buildTrainingSpec, buildTrainingToolPolicy, type TrainingData } from '@infra/ai/graph/phases/training.spec';
import { sessionRow } from '@infra/ai/load-facts/__tests__/rows';
import { EFFORT_QUESTION } from '@infra/ai/prompts/effort';
import { RunMetricsCollector } from '@infra/ai/run-metrics';

import { type CannedResponse, makeCapturingModel, type WireRequest } from '../../../context/__tests__/request-capture';

export const state: {
  model: ReturnType<typeof makeCapturingModel>['model'] | undefined;
  data: Data;
  config: Record<string, unknown>;
} = { model: undefined, data: undefined as never, config: {} };

export const USER = { id: 'u1', languageCode: 'ru', timezone: 'Europe/Berlin' as string | null };

export const stub = (name: string) =>
  tool(async () => 'ok', { name, description: `${name} stub`, schema: z.object({ x: z.string().optional() }) });
export const TOOLS = [
  'search_exercises',
  'log_set',
  'complete_current_exercise',
  'finish_training',
  'delete_last_sets',
  'update_last_set',
].map(stub);

export interface Data {
  session: { exercises: Array<{ status: string; sets: unknown[] }> };
  overview: string;
}

/** A training-shaped fake phase: real training tool policy, one volatile domain block (block 3). */
export function makeSpec(): PhaseSpec<Data> {
  return {
    name: 'training',
    prompt: {
      current: {
        id: 'phase.test',
        version: 'v1',
        directives: [],
        render: () => [{ id: 'task', text: 'You are the training coach. '.repeat(20), required: true }],
      },
      requiredSections: [],
    } as unknown as PhaseSpec<Data>['prompt'],
    tools: TOOLS as never,
    toolPolicy: buildTrainingToolPolicy(TOOLS as never),
    loadContext: async () => ({ ok: true as const, data: state.data }),
    contextBlocks: [{ id: 'overview', version: 'v1', render: d => `WORKOUT OVERVIEW\n${d.overview}` }],
    modelProfile: 'default',
    budget: { system: 5000, longTerm: 1500, domain: 6000, history: 8000, outputReserve: 100 },
  };
}

export const noSets = (): Data => ({
  session: { exercises: [{ status: 'in_progress', sets: [] }] },
  overview: 'squat: 0 sets',
});
export const oneSet = (): Data => ({
  session: { exercises: [{ status: 'in_progress', sets: [{}] }] },
  overview: 'squat: 1 set (60 kg × 8)',
});

export const deps = (): ConversationGraphDeps =>
  ({
    userService: { getUser: async () => USER },
    userFacts: {
      getForPrompt: async () => [],
      getConstraints: jest.fn(),
      upsertMany: jest.fn(),
    },
    // 30 s gap so "a minute later" produces the gap note on the second run.
    episodeConfig: { gapMs: 30_000, minTurns: 2, minTokens: 300, keepTurns: 6 },
  }) as unknown as ConversationGraphDeps;

export function configAt(now: Date): RunnableConfig {
  const metrics = new RunMetricsCollector('run-1');
  return {
    configurable: { userId: 'u1' },
    metadata: { runId: 'run-1', userId: 'u1' },
    context: {
      runId: 'run-1',
      userId: 'u1',
      user: USER as never,
      now,
      client: 'telegram' as const,
      trigger: 'user_message' as const,
      metrics,
    },
  } as never as RunnableConfig;
}

export const T0 = new Date('2026-09-29T10:15:00Z');
export const T1 = new Date(T0.getTime() + 60_000);

export const history0 = (): BaseMessage[] => [
  new HumanMessage({ content: 'привет', id: 'h0' }),
  new AIMessage({ content: 'Привет! Начинаем?', id: 'a0' }),
];

export async function run(
  messages: BaseMessage[],
  opts: {
    now: Date;
    lastUserMessageAt?: string | null;
    responses?: CannedResponse[];
    /** A different phase spec (the real training spec with the LOAD_PLAN flags on) and its deps. */
    spec?: PhaseSpec<never>;
    deps?: ConversationGraphDeps;
  },
): Promise<{ requests: WireRequest[]; out: { messages: BaseMessage[] } }> {
  const cap = makeCapturingModel(opts.responses);
  state.model = cap.model;
  const node = buildAgentNode(opts.spec ?? makeSpec(), opts.deps ?? deps());
  const out = await node({ messages, lastUserMessageAt: opts.lastUserMessageAt ?? null }, configAt(opts.now));
  return { requests: cap.requests, out };
}

/** Index of the last human message in a wire request. */
export const lastHumanIndex = (r: WireRequest): number => r.messages.map(m => m.role).lastIndexOf('user');

/**
 * The REAL training spec (tools, prompt selection, context blocks) with LOAD_PLAN_SUGGESTION + LOAD_PLAN_BREAKS +
 * LOAD_PLAN_PLANNER_REBIND on — training v12 and LOAD PLAN v2 — over fixed `TrainingData` (`loadContext` is replaced;
 * nothing else is). The deps carry only what `buildTrainingSpec` reads to construct the tools.
 */
export function makeLoadPlanTrainingSpec(data: () => TrainingData): {
  spec: PhaseSpec<never>;
  deps: ConversationGraphDeps;
} {
  const flagged = {
    ...(deps() as unknown as Record<string, unknown>),
    loadPlanSuggestion: true,
    loadPlanBreaks: true,
    loadPlanPlannerRebind: true,
    trainingService: {},
    exerciseRepository: {},
    embeddingService: {},
    workoutSessionRepo: {},
  } as unknown as ConversationGraphDeps;
  const real = buildTrainingSpec(flagged);
  const spec = { ...real, loadContext: async () => ({ ok: true as const, data: data() }) };
  return { spec: spec as unknown as PhaseSpec<never>, deps: flagged };
}

// --- the real training phase with the LOAD_PLAN flags on (training v12 + LOAD PLAN v2) ---

const LEG_PRESS = {
  id: '44444444-4444-4444-8444-444444444444',
  name: '45° Leg Press',
  muscles: [['quads', 'primary']] as never,
};

/** TrainingData with a real LOAD PLAN entry (owner leg-press history); `sets` = today's logged sets on the exercise. */
export function loadPlanTrainingData(todaySets: number): TrainingData {
  const past = LEG_PRESS_ROWS.filter(r => r.date <= '2026-09-21').map(r => {
    const at = new Date(`${r.date}T04:00:00Z`);
    return sessionRow(`s-${r.date}`, new Date(at.getTime() - 3_600_000), [
      {
        rowId: `r-${r.date}`,
        ...LEG_PRESS,
        targetReps: r.targetReps,
        sets: r.sets.map(([weight, reps], i) => ({ weight, reps, at: new Date(at.getTime() + i * 120_000) })),
      },
    ]);
  });
  const now = ownerNow('2026-09-21', 4);
  const session = sessionRow(
    'today',
    now,
    [
      {
        rowId: 'rt',
        ...LEG_PRESS,
        targetReps: '10-12',
        sets: Array.from({ length: todaySets }, (_v, i) => ({
          weight: 120,
          reps: 12,
          at: new Date(now.getTime() + i * 120_000),
        })),
      },
    ],
    { status: 'in_progress' },
  );
  const performances = past.map(p => ({
    id: p.exercises[0].id,
    sessionId: p.id,
    place: null,
    startedAt: p.startedAt,
    performedAt: p.completedAt ?? p.startedAt,
    targetReps: p.exercises[0].targetReps,
    sets: p.exercises[0].sets.map(s => ({
      setData: s.setData,
      setKind: s.setKind ?? null,
      rpe: s.rpe,
      userFeedback: s.userFeedback,
      createdAt: s.createdAt,
    })),
    otherSets: [],
  }));
  const exercise = {
    id: LEG_PRESS.id,
    name: LEG_PRESS.name,
    exerciseType: 'strength' as const,
    equipment: 'machine' as const,
    muscles: [{ muscleGroup: 'quads' as const, involvement: 'primary' as const }],
  };
  const facts = computeLoadFacts(
    exercise,
    performances as never,
    { sessionId: 'today', place: null, startedAt: now, targetReps: '10-12', sets: [], otherSets: [] },
    { constraints: [], equipmentFacts: [], workouts: [] },
    now,
    null,
  );
  return {
    session,
    exerciseHistory: [],
    recentWorkouts: [],
    todayMuscles: ['quads'],
    recentPlacesCount: 0,
    loadPlan: [{ exercise, facts, returnBranch: { ladder: null, breakReason: 'unknown' } }],
    progression: defaultProgression(null),
  } as unknown as TrainingData;
}

export const EFFORT_HINT_RESULT = `Set 1 logged — 45° Leg Press: 12 reps @ 120 kg.\n\nEffort hint: this set is decision-critical (the last planned set) and was stored without RPE. Ask once, in plain words: «${EFFORT_QUESTION}»`;
