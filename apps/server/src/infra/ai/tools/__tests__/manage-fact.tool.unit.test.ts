/**
 * manage_fact (fact-lifecycle plan Task 2, AC-FL-2/AC-FL-3/AC-FL-8): the ONE
 * tool through which the coach writes, corrects, retracts and deletes facts in
 * conversation. One tool (not remember/retract/delete tools) on purpose: the
 * archive-vs-delete distinction must be an explicit per-call choice, and the
 * "ask when ambiguous" rule lives in exactly one description. Bounds and the
 * permanent gate are owned by fact-lifecycle.ts via the port — the tool only
 * maps inputs, run clock and outcomes.
 */
import type { RunnableConfig } from '@langchain/core/runnables';

import { PermanentFactRefusal } from '@domain/user/services/fact-lifecycle';
import type { IUserFactsService, RememberFactOutcome, UserFact } from '@domain/user/ports';

import { isToolReturnWithUpdate, type ToolOutcome, type ToolReturn } from '@domain/conversation/tool-outcome';

import { buildManageFactTool } from '../manage-fact.tool';

type InvokableTool = {
  invoke: (input: Record<string, unknown>, config?: RunnableConfig) => Promise<unknown>;
};

const NOW = new Date('2026-09-21T12:00:00Z');

function makeFact(overrides: Partial<UserFact> = {}): UserFact {
  return {
    id: 'f1',
    userId: 'u1',
    category: 'physical_constraint',
    fact: 'Broken wrist',
    factKey: 'broken wrist',
    muscleGroup: null,
    confirmations: 1,
    sourceTurnId: null,
    createdAt: NOW,
    updatedAt: NOW,
    durability: 'long_term',
    expiresAt: null,
    reviewAfter: new Date('2026-12-01T00:00:00Z'),
    phaseNote: 'in a cast',
    phaseAt: NOW,
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

function makeFactsService(): jest.Mocked<IUserFactsService> {
  return {
    upsertMany: jest.fn(),
    getForPrompt: jest.fn(),
    getConstraints: jest.fn(),
    rememberFact: jest.fn(),
    retractFact: jest.fn(),
    deleteFact: jest.fn(),
    listFacts: jest.fn(),
  } as unknown as jest.Mocked<IUserFactsService>;
}

const makeConfig = (userId = 'u1'): RunnableConfig =>
  ({
    configurable: { userId, thread_id: userId },
    // The run context the graph threads to tools — the facts clock is ctx.now.
    context: { runId: 'run-test', userId, now: NOW },
  }) as unknown as RunnableConfig;

const buildTool = (svc: jest.Mocked<IUserFactsService>): InvokableTool =>
  buildManageFactTool({ userFactsService: svc }) as unknown as InvokableTool;

function outcomeOf(ret: unknown): ToolOutcome {
  const r = ret as ToolReturn;
  return isToolReturnWithUpdate(r) ? r.outcome : r;
}

describe('manage_fact — operation save', () => {
  it('calls rememberFact with the input and the RUN clock (ctx.now), returns ok', async () => {
    const svc = makeFactsService();
    svc.rememberFact.mockResolvedValue({ outcome: 'created', fact: makeFact() } satisfies RememberFactOutcome);
    const tool = buildTool(svc);

    const ret = outcomeOf(
      await tool.invoke(
        {
          operation: 'save',
          category: 'physical_constraint',
          fact: 'Broken wrist',
          durability: 'long_term',
          reviewInDays: 60,
          phaseNote: 'in a cast',
        },
        makeConfig(),
      ),
    );

    expect(svc.rememberFact).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        category: 'physical_constraint',
        fact: 'Broken wrist',
        factId: undefined,
        durability: 'long_term',
        reviewInDays: 60,
        phaseNote: 'in a cast',
        // unset optionals normalise to null — never leak into the domain as undefined
        muscleGroup: null,
        context: null,
      }),
      NOW,
    );
    expect(ret).toMatchObject({ ok: true });
    expect(ret.ok && ret.summary).toContain('Broken wrist');
  });

  it('passes explicitPermanent through — the owner gate input, never restated here', async () => {
    const svc = makeFactsService();
    svc.rememberFact.mockResolvedValue({ outcome: 'created', fact: makeFact({ durability: 'permanent' }) });
    const tool = buildTool(svc);

    await tool.invoke(
      {
        operation: 'save',
        category: 'equipment',
        fact: 'Has a prosthesis',
        durability: 'permanent',
        explicitPermanent: true,
      },
      makeConfig(),
    );

    expect(svc.rememberFact.mock.calls[0][1]).toMatchObject({ explicitPermanent: true });
  });

  it('maps PermanentFactRefusal to an llm_error that tells the model to confirm with the user', async () => {
    const svc = makeFactsService();
    svc.rememberFact.mockRejectedValue(new PermanentFactRefusal());
    const tool = buildTool(svc);

    const ret = outcomeOf(
      await tool.invoke(
        { operation: 'save', category: 'physical_constraint', fact: 'Bad back forever', durability: 'permanent' },
        makeConfig(),
      ),
    );

    expect(ret).toMatchObject({ ok: false, kind: 'llm_error' });
    expect(!ret.ok && ret.message).toContain('permanent');
    expect(!ret.ok && ret.hint).toContain('user');
  });

  it('without a userId it returns a user_error, calling nothing', async () => {
    const svc = makeFactsService();
    const tool = buildTool(svc);

    const ret = outcomeOf(
      await tool.invoke(
        { operation: 'save', category: 'equipment', fact: 'Has a barbell', durability: 'short' },
        { configurable: {} },
      ),
    );

    expect(ret).toMatchObject({ ok: false, kind: 'user_error' });
    expect(svc.rememberFact).not.toHaveBeenCalled();
  });
});

describe('manage_fact — operation retract (archives, NEVER deletes)', () => {
  it('calls retractFact with the fact id and the run clock; reports the closure', async () => {
    const svc = makeFactsService();
    svc.retractFact.mockResolvedValue(makeFact({ status: 'archived', archivedReason: 'user_closed' }));
    const tool = buildTool(svc);

    const ret = outcomeOf(
      await tool.invoke({ operation: 'retract', factId: '5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, makeConfig()),
    );

    expect(svc.retractFact).toHaveBeenCalledWith('u1', { factId: '5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, NOW);
    expect(ret).toMatchObject({ ok: true });
    expect(ret.ok && ret.summary).toContain('archived');
    expect(svc.deleteFact).not.toHaveBeenCalled();
  });

  it('an unknown fact id is an llm_error (the model can re-list and retry)', async () => {
    const svc = makeFactsService();
    svc.retractFact.mockResolvedValue(null);
    const tool = buildTool(svc);

    const ret = outcomeOf(
      await tool.invoke({ operation: 'retract', factId: '5b0f8a3e-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, makeConfig()),
    );

    expect(ret).toMatchObject({ ok: false, kind: 'llm_error' });
  });
});

describe('manage_fact — operation delete (a SEPARATE operation, never a silent swap for retract)', () => {
  it('refuses with a user_error asking the user, unless the model confirms explicit user consent', async () => {
    const svc = makeFactsService();
    const tool = buildTool(svc);

    const ret = outcomeOf(
      await tool.invoke(
        { operation: 'delete', factId: '5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa', confirmed: false },
        makeConfig(),
      ),
    );

    expect(ret).toMatchObject({ ok: false, kind: 'user_error' });
    expect(!ret.ok && `${ret.message} ${ret.hint ?? ''}`).toContain('delete');
    expect(svc.deleteFact).not.toHaveBeenCalled();
  });

  it('with confirmed=true it deletes the row entirely — no archive, no trace', async () => {
    const svc = makeFactsService();
    svc.deleteFact.mockResolvedValue(true);
    const tool = buildTool(svc);

    const ret = outcomeOf(
      await tool.invoke(
        { operation: 'delete', factId: '5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa', confirmed: true },
        makeConfig(),
      ),
    );

    expect(svc.deleteFact).toHaveBeenCalledWith('u1', '5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(ret).toMatchObject({ ok: true });
    expect(svc.retractFact).not.toHaveBeenCalled();
  });

  it('a missing fact id is an llm_error', async () => {
    const svc = makeFactsService();
    const tool = buildTool(svc);

    const ret = outcomeOf(await tool.invoke({ operation: 'delete', confirmed: true }, makeConfig()));

    expect(ret).toMatchObject({ ok: false, kind: 'llm_error' });
    expect(svc.deleteFact).not.toHaveBeenCalled();
  });
});
