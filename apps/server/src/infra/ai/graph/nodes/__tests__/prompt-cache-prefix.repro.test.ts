/**
 * Prompt-caching plan (BUG-051) T2 — red tests AC-PC-1, -2, -3, -4 (bound tools), -5 over the SERIALISED
 * request: a real ChatOpenAI with a capturing `fetch` (request-capture.ts), the agent node and the real
 * training tool policy around it. `*.repro.test.ts` is outside jest's default testMatch on purpose: red
 * until T3 (prefix, D2–D4) and T4 (breakpoints, D6) land, then renamed `*.unit.test.ts`.
 *
 * Interface these tests assume (T3/T4 implement to it — recorded in the plan § Evidence, T2):
 *  - config `LLM_PROMPT_CACHE` ('off' | 'anthropic', default 'off') and `LLM_PROMPT_CACHE_TTL` ('5m' | '1h'),
 *    read through `loadConfig()` at request time;
 *  - volatile context rides in the current HumanMessage as a leading `<context>…</context>` text part.
 */
import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { buildAgentNode } from '@infra/ai/graph/nodes/agent.node';
import type { ConversationGraphDeps, PhaseSpec } from '@infra/ai/graph/phase-spec';
import { buildTrainingToolPolicy } from '@infra/ai/graph/phases/training.spec';
import { RunMetricsCollector } from '@infra/ai/run-metrics';

import {
  cacheControlParts,
  type CannedResponse,
  makeCapturingModel,
  type WireRequest,
  wireText,
} from '../../../context/__tests__/request-capture';

let currentModel: ReturnType<typeof makeCapturingModel>['model'];
jest.mock('@infra/ai/model.factory', () => ({ getModel: () => currentModel }));

let configOverrides: Record<string, unknown> = {};
jest.mock('@config/index', () => {
  const actual = jest.requireActual('@config/index');
  return { ...actual, loadConfig: () => ({ ...actual.loadConfig(), ...configOverrides }) };
});

jest.mock('@shared/logger', () => {
  const fns = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => fns };
});

const USER = { id: 'u1', languageCode: 'ru', timezone: 'Europe/Berlin' as string | null };

const stub = (name: string) =>
  tool(async () => 'ok', { name, description: `${name} stub`, schema: z.object({ x: z.string().optional() }) });
const TOOLS = [
  'search_exercises',
  'log_set',
  'complete_current_exercise',
  'finish_training',
  'delete_last_sets',
  'update_last_set',
].map(stub);

interface Data {
  session: { exercises: Array<{ status: string; sets: unknown[] }> };
  overview: string;
}

/** A training-shaped fake phase: real training tool policy, one volatile domain block (block 3). */
function makeSpec(): PhaseSpec<Data> {
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
    loadContext: async () => ({ ok: true as const, data: currentData }),
    contextBlocks: [{ id: 'overview', version: 'v1', render: d => `WORKOUT OVERVIEW\n${d.overview}` }],
    modelProfile: 'default',
    budget: { system: 5000, longTerm: 1500, domain: 6000, history: 8000, outputReserve: 100 },
  };
}

let currentData: Data;
const noSets = (): Data => ({
  session: { exercises: [{ status: 'in_progress', sets: [] }] },
  overview: 'squat: 0 sets',
});
const oneSet = (): Data => ({
  session: { exercises: [{ status: 'in_progress', sets: [{}] }] },
  overview: 'squat: 1 set (60 kg × 8)',
});

const deps = (): ConversationGraphDeps =>
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

function configAt(now: Date): RunnableConfig {
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

const T0 = new Date('2026-09-29T10:15:00Z');
const T1 = new Date(T0.getTime() + 60_000);

const history0 = (): BaseMessage[] => [
  new HumanMessage({ content: 'привет', id: 'h0' }),
  new AIMessage({ content: 'Привет! Начинаем?', id: 'a0' }),
];

async function run(
  messages: BaseMessage[],
  opts: { now: Date; lastUserMessageAt?: string | null; responses?: CannedResponse[] },
): Promise<{ requests: WireRequest[]; out: { messages: BaseMessage[] } }> {
  const cap = makeCapturingModel(opts.responses);
  currentModel = cap.model;
  const node = buildAgentNode(makeSpec(), deps());
  const out = await node({ messages, lastUserMessageAt: opts.lastUserMessageAt ?? null }, configAt(opts.now));
  return { requests: cap.requests, out };
}

/** Index of the last human message in a wire request. */
const lastHumanIndex = (r: WireRequest): number => r.messages.map(m => m.role).lastIndexOf('user');

beforeEach(() => {
  configOverrides = {};
  currentData = noSets();
});

describe('AC-PC-1: two consecutive training runs share a byte-identical prefix up to breakpoint 2', () => {
  async function twoRuns() {
    currentData = noSets();
    const first = await run([...history0(), new HumanMessage({ content: 'жим 60 на 8', id: 'h1' })], { now: T0 });
    // Between the runs: a set was logged (block 3 + availability changed), NOW moved a minute, gap note appears.
    currentData = oneSet();
    const second = await run(
      [
        ...history0(),
        new HumanMessage({ content: 'жим 60 на 8', id: 'h1' }),
        new AIMessage({ content: 'Записал!', id: 'a1' }),
        new HumanMessage({ content: 'ещё подход', id: 'h2' }),
      ],
      { now: T1, lastUserMessageAt: T0.toISOString() },
    );
    return { r1: first.requests[0]!, r2: second.requests[0]! };
  }

  it('AC-PC-1: the tool list of the second request equals the first (a set was logged in between)', async () => {
    const { r1, r2 } = await twoRuns();
    expect(r2.tools?.map(t => t.function.name)).toEqual(r1.tools?.map(t => t.function.name));
    expect(JSON.stringify(r2.tools)).toBe(JSON.stringify(r1.tools));
  });

  it('AC-PC-1: messages before the first request’s breakpoint 2 (everything ahead of its current turn) are identical in the second', async () => {
    const { r1, r2 } = await twoRuns();
    const prefix1 = r1.messages.slice(0, lastHumanIndex(r1));
    const prefix2 = r2.messages.slice(0, prefix1.length);
    expect(JSON.stringify(prefix2)).toBe(JSON.stringify(prefix1));
  });
});

describe('AC-PC-2: no SystemMessage after the first message, in every kind of request', () => {
  const systemsAfterFirst = (r: WireRequest) => r.messages.slice(1).filter(m => m.role === 'system');

  it('AC-PC-2: plain call with block 3, gap note and NOW line', async () => {
    const { requests } = await run([...history0(), new HumanMessage({ content: 'ещё', id: 'h1' })], {
      now: T1,
      lastUserMessageAt: T0.toISOString(),
    });
    expect(systemsAfterFirst(requests[0]!)).toEqual([]);
  });

  it('AC-PC-2: post-tool call (the nudge no longer rides as a SystemMessage)', async () => {
    const inFlight: BaseMessage[] = [
      new HumanMessage({ content: 'жим 60 на 8', id: 'h1' }),
      new AIMessage({
        content: '',
        id: 'a1',
        tool_calls: [{ id: 'c1', name: 'log_set', args: {}, type: 'tool_call' }],
      }),
      new ToolMessage({ tool_call_id: 'c1', content: 'Logged set 1', id: 't1' }),
    ];
    const { requests } = await run([...history0(), ...inFlight], { now: T0 });
    expect(systemsAfterFirst(requests[0]!)).toEqual([]);
  });

  it('AC-PC-2: empty-reply retry request', async () => {
    const { requests } = await run([...history0(), new HumanMessage({ content: 'ещё', id: 'h1' })], {
      now: T0,
      responses: [{ content: '' }, { content: 'ok' }],
    });
    expect(requests).toHaveLength(2);
    expect(systemsAfterFirst(requests[0]!)).toEqual([]);
    expect(systemsAfterFirst(requests[1]!)).toEqual([]);
  });
});

describe('AC-PC-3: cache_control breakpoints behind LLM_PROMPT_CACHE (D1, D6)', () => {
  const messages = () => [...history0(), new HumanMessage({ content: 'жим 60 на 8', id: 'h1' })];

  it('AC-PC-3: anthropic/5m → exactly two breakpoints: last system part and last history message', async () => {
    configOverrides = { LLM_PROMPT_CACHE: 'anthropic', LLM_PROMPT_CACHE_TTL: '5m' };
    const { requests } = await run(messages(), { now: T0 });
    const r = requests[0]!;
    const parts = cacheControlParts(r);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.messageIndex).toBe(0);
    expect(r.messages[0]!.role).toBe('system');
    // Breakpoint 2 = the last message of history = the one right before the current human message.
    expect(parts[1]!.messageIndex).toBe(lastHumanIndex(r) - 1);
    expect(wireText(r.messages[parts[1]!.messageIndex]!)).toContain('Начинаем');
    expect(parts.map(p => p.part)).toEqual([{ type: 'ephemeral' }, { type: 'ephemeral' }]);
  });

  it('AC-PC-3: anthropic/1h → both breakpoints carry ttl "1h"', async () => {
    configOverrides = { LLM_PROMPT_CACHE: 'anthropic', LLM_PROMPT_CACHE_TTL: '1h' };
    const { requests } = await run(messages(), { now: T0 });
    const parts = cacheControlParts(requests[0]!);
    expect(parts.map(p => p.part)).toEqual([
      { type: 'ephemeral', ttl: '1h' },
      { type: 'ephemeral', ttl: '1h' },
    ]);
  });

  it('AC-PC-3: off (and the default) → no cache_control anywhere in the body', async () => {
    configOverrides = { LLM_PROMPT_CACHE: 'off' };
    const off = await run(messages(), { now: T0 });
    expect(JSON.stringify(off.requests[0])).not.toContain('cache_control');
    configOverrides = {};
    const dflt = await run(messages(), { now: T0 });
    expect(JSON.stringify(dflt.requests[0])).not.toContain('cache_control');
  });

  it('AC-PC-3: the two-breakpoint layout survives a post-tool call — none on the in-flight messages', async () => {
    configOverrides = { LLM_PROMPT_CACHE: 'anthropic', LLM_PROMPT_CACHE_TTL: '5m' };
    const inFlight: BaseMessage[] = [
      new HumanMessage({ content: 'жим 60 на 8', id: 'h1' }),
      new AIMessage({
        content: '',
        id: 'a1',
        tool_calls: [{ id: 'c1', name: 'log_set', args: {}, type: 'tool_call' }],
      }),
      new ToolMessage({ tool_call_id: 'c1', content: 'Logged set 1', id: 't1' }),
    ];
    const { requests } = await run([...history0(), ...inFlight], { now: T0 });
    const r = requests[0]!;
    const parts = cacheControlParts(r);
    expect(parts).toHaveLength(2);
    expect(parts[1]!.messageIndex).toBeLessThan(lastHumanIndex(r));
  });
});

describe('AC-PC-4 (bound tools): the bound tool list does not depend on session state (D4)', () => {
  it('AC-PC-4: delete_last_sets / update_last_set are bound before the first set of the current exercise', async () => {
    currentData = noSets();
    const { requests } = await run([...history0(), new HumanMessage({ content: 'привет', id: 'h1' })], { now: T0 });
    const names = requests[0]!.tools?.map(t => t.function.name) ?? [];
    expect(names).toEqual(TOOLS.map(t => t.name));
  });
});

describe('AC-PC-5: the checkpointed HumanMessage carries no <context> text (D2)', () => {
  it('AC-PC-5: the request has the context part in the current user message; the state message stays the raw text', async () => {
    currentData = oneSet();
    const human = new HumanMessage({ content: 'ещё подход', id: 'h1' });
    const { requests, out } = await run([...history0(), human], { now: T1, lastUserMessageAt: T0.toISOString() });
    const r = requests[0]!;

    // The wire request carries the volatile context inside the current human message…
    const currentUser = r.messages[lastHumanIndex(r)]!;
    expect(wireText(currentUser)).toContain('<context>');
    expect(wireText(currentUser)).toContain('WORKOUT OVERVIEW');
    expect(wireText(currentUser)).toContain('ещё подход');

    // …while nothing the node hands back to the checkpoint, and no input message, was rewritten.
    expect(human.content).toBe('ещё подход');
    for (const m of out.messages) {
      expect(JSON.stringify(m.content)).not.toContain('<context>');
    }
  });
});
