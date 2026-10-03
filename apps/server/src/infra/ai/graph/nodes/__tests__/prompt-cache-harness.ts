/**
 * Shared harness for the prompt-caching request tests (AC-PC-1..5): the agent node over a training-shaped fake
 * phase with the real training tool policy, a real ChatOpenAI with a capturing `fetch` (request-capture.ts).
 * The test files register the `jest.mock` calls (model.factory → `state.model`, @config/index → `state.config`).
 */
import { AIMessage, type BaseMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { buildAgentNode } from '@infra/ai/graph/nodes/agent.node';
import type { ConversationGraphDeps, PhaseSpec } from '@infra/ai/graph/phase-spec';
import { buildTrainingSpec, buildTrainingToolPolicy, type TrainingData } from '@infra/ai/graph/phases/training.spec';
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
    contextBlocks: [{ id: 'overview', version: 'v1', render: d => `TODAY\n${d.overview}` }],
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
 * The REAL training spec (tools, prompt, `# Today` / `# History` blocks, `memory: 'workout'`) over fixed
 * `TrainingData` (`loadContext` is replaced; nothing else is). The deps carry only what `buildTrainingSpec` reads to
 * construct the tools.
 */
export function makeRealTrainingSpec(data: () => TrainingData): {
  spec: PhaseSpec<never>;
  deps: ConversationGraphDeps;
} {
  const real = {
    ...(deps() as unknown as Record<string, unknown>),
    trainingService: {},
    exerciseRepository: {},
    embeddingService: {},
    workoutSessionRepo: {},
  } as unknown as ConversationGraphDeps;
  const spec = { ...buildTrainingSpec(real), loadContext: async () => ({ ok: true as const, data: data() }) };
  return { spec: spec as unknown as PhaseSpec<never>, deps: real };
}

const LEG_PRESS_ID = '44444444-4444-4444-8444-444444444444';

/** Plain TrainingData: a leg-press plan, `todaySets` sets logged so far, one earlier performance in the history. */
export function trainingData(todaySets: number): TrainingData {
  const at = new Date('2026-09-29T10:00:00Z');
  const set = (n: number, weight: number) => ({
    id: `set-${n}`,
    sessionExerciseId: 'se-1',
    setNumber: n,
    rpe: 8,
    userFeedback: null,
    createdAt: at,
    completedAt: null,
    setData: { type: 'strength' as const, reps: 12, weight, weightUnit: 'kg' as const },
  });
  const session = {
    id: 'today',
    createdAt: at,
    startedAt: at,
    updatedAt: T0,
    place: null,
    sessionPlanJson: {
      exercises: [{ exerciseId: LEG_PRESS_ID, exerciseName: '45° Leg Press', targetSets: 4, targetReps: '12' }],
    },
    exercises: [
      {
        exerciseId: LEG_PRESS_ID,
        status: 'in_progress',
        exercise: { name: '45° Leg Press' },
        sets: Array.from({ length: todaySets }, (_v, i) => set(i + 1, 120)),
      },
    ],
  };
  return {
    session,
    history: [
      {
        exerciseId: LEG_PRESS_ID,
        exerciseName: '45° Leg Press',
        plannedText: '4×12',
        lastSkippedAt: null,
        performances: [
          {
            exerciseId: LEG_PRESS_ID,
            completedAt: new Date('2026-09-21T10:00:00Z'),
            sessionExercise: { sets: [set(1, 110), set(2, 110)] },
          },
        ],
      },
    ],
    lastWorkout: null,
    profileFacts: [],
  } as unknown as TrainingData;
}

export const SET_RESULT = 'Set 1 logged — 45° Leg Press: 12 reps @ 120 kg.';
