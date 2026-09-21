/**
 * list_facts (fact-lifecycle plan Task 2, AC-FL-8): what answers "what do you
 * remember about me" — every ACTIVE fact grouped by category, each with its
 * date, confirmation count and durability class; the archived ones with their
 * closure reason only when explicitly asked. The `## User Facts` prompt block
 * is capped and ordered for steering, not for review — it cannot serve this.
 */
import type { RunnableConfig } from '@langchain/core/runnables';

import type { IUserFactsService, UserFact } from '@domain/user/ports';

import { isToolReturnWithUpdate, type ToolOutcome, type ToolReturn } from '@domain/conversation/tool-outcome';

import { buildListFactsTool } from '../list-facts.tool';

type InvokableTool = {
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

const NOW = new Date('2026-09-21T12:00:00Z');

function fact(overrides: Partial<UserFact> = {}): UserFact {
  return {
    id: 'f1',
    userId: 'u1',
    category: 'equipment',
    fact: 'Trains at home with dumbbells only',
    factKey: 'trains at home with dumbbells only',
    muscleGroup: null,
    confirmations: 2,
    sourceTurnId: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-10T00:00:00Z'),
    durability: 'permanent',
    expiresAt: null,
    reviewAfter: null,
    phaseNote: null,
    phaseAt: null,
    onExpiry: null,
    status: 'active',
    archivedAt: null,
    archivedReason: null,
    closedByUserAt: null,
    supersedesId: null,
    context: null,
    ...overrides,
  };
}

function makeFactsService(rows: { active: UserFact[]; archived: UserFact[] }): jest.Mocked<IUserFactsService> {
  return {
    upsertMany: jest.fn(),
    getForPrompt: jest.fn(),
    getConstraints: jest.fn(),
    rememberFact: jest.fn(),
    retractFact: jest.fn(),
    forgetFact: jest.fn(),
    // The real port's contract: archived rows come back ONLY when asked.
    listFacts: jest.fn(async (_userId: string, includeArchived: boolean) => ({
      active: rows.active,
      archived: includeArchived ? rows.archived : [],
    })),
  } as unknown as jest.Mocked<IUserFactsService>;
}

const makeConfig = (userId = 'u1'): RunnableConfig =>
  ({
    configurable: { userId, thread_id: userId },
    context: { runId: 'run-test', userId, now: NOW },
  }) as unknown as RunnableConfig;

const buildTool = (svc: jest.Mocked<IUserFactsService>): InvokableTool =>
  buildListFactsTool({ userFactsService: svc }) as unknown as InvokableTool;

function summaryOf(ret: unknown): string {
  const r = ret as ToolReturn;
  const outcome: ToolOutcome = isToolReturnWithUpdate(r) ? r.outcome : r;
  expect(outcome).toMatchObject({ ok: true });
  return outcome.ok ? outcome.summary : '';
}

describe('list_facts (AC-FL-8)', () => {
  it('asks the port for ACTIVE facts only by default — archived never appear unasked', async () => {
    const svc = makeFactsService({ active: [fact()], archived: [] });
    const tool = buildTool(svc);

    await tool.invoke({}, makeConfig());

    expect(svc.listFacts).toHaveBeenCalledWith('u1', false, NOW);
  });

  it('includeArchived=true is passed through — the archived set comes back', async () => {
    const svc = makeFactsService({ active: [], archived: [] });
    const tool = buildTool(svc);

    await tool.invoke({ includeArchived: true }, makeConfig());

    expect(svc.listFacts).toHaveBeenCalledWith('u1', true, NOW);
  });

  it('renders each active fact with its ID FIRST on the line, plus category, date, count and class (BUG-020)', async () => {
    const svc = makeFactsService({
      active: [
        fact({
          id: '5b0f8a3e-1111-4111-8111-111111111111',
          confirmations: 2,
          updatedAt: new Date('2026-09-10T00:00:00Z'),
        }),
        fact({
          id: '5b0f8a3e-2222-4222-8222-222222222222',
          category: 'physical_constraint',
          fact: 'Sore shoulder',
          durability: 'short',
          expiresAt: new Date('2026-09-25T00:00:00Z'),
          confirmations: 1,
        }),
      ],
      archived: [],
    });
    const tool = buildTool(svc);

    const text = summaryOf(await tool.invoke({}, makeConfig()));

    // The id leads the line, in summariser v4's exact shape — copyable, not prose.
    expect(text).toContain('- id 5b0f8a3e-1111-4111-8111-111111111111: Trains at home with dumbbells only');
    expect(text).toContain('- id 5b0f8a3e-2222-4222-8222-222222222222: Sore shoulder');
    expect(text).toContain('equipment');
    expect(text).toContain('2× confirmed'); // the confirmation count renders
    expect(text).toContain('permanent'); // the durability class renders
    expect(text).toContain('2026-09-10'); // the date renders
    expect(text).toContain('physical_constraint');
    expect(text).toContain('short');
  });

  it('renders archived facts with their closure reason only when asked', async () => {
    const svc = makeFactsService({
      active: [fact()],
      archived: [
        fact({
          id: 'a1',
          category: 'physical_constraint',
          fact: 'Old shoulder tweak',
          status: 'archived',
          archivedAt: new Date('2026-09-01T00:00:00Z'),
          archivedReason: 'user_closed',
          closedByUserAt: new Date('2026-09-01T00:00:00Z'),
          durability: 'short',
        }),
      ],
    });
    const tool = buildTool(svc);

    const withoutAsking = summaryOf(await tool.invoke({}, makeConfig()));
    expect(withoutAsking).not.toContain('Old shoulder tweak');

    const asked = summaryOf(await tool.invoke({ includeArchived: true }, makeConfig()));
    expect(asked).toContain('Old shoulder tweak');
    expect(asked).toContain('user_closed');
    expect(asked).toContain('2026-09-01');
    // Archived lines carry their id too — retract/delete need it there as well.
    expect(asked).toContain('- id a1: Old shoulder tweak');
  });

  it('no facts at all renders a friendly empty answer, not an error', async () => {
    const svc = makeFactsService({ active: [], archived: [] });
    const tool = buildTool(svc);

    const text = summaryOf(await tool.invoke({}, makeConfig()));

    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).toContain('nothing');
  });

  it('without a userId it returns a user_error', async () => {
    const svc = makeFactsService({ active: [], archived: [] });
    const tool = buildTool(svc);

    const ret = (await tool.invoke({}, { configurable: {} })) as ToolReturn;

    expect(ret).toMatchObject({ ok: false, kind: 'user_error' });
  });
});
