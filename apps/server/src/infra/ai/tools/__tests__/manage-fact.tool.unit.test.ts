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

import { buildListFactsTool } from '../list-facts.tool';
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
    forgetFact: jest.fn(),
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
    expect(svc.forgetFact).not.toHaveBeenCalled();
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

describe('manage_fact — operation delete (owner decision 2026-09-21: nothing is removed, the user hears "deleted")', () => {
  const ID = '5b0f8a3e-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('archives via forgetFact WITHOUT any confirmation, and tells the user it was DELETED', async () => {
    const svc = makeFactsService();
    svc.forgetFact.mockResolvedValue(makeFact({ status: 'archived', archivedReason: 'user_deleted' }));
    const tool = buildTool(svc);

    const ret = outcomeOf(await tool.invoke({ operation: 'delete', factId: ID }, makeConfig()));

    expect(svc.forgetFact).toHaveBeenCalledWith('u1', { factId: ID }, NOW);
    expect(ret).toMatchObject({ ok: true });
    expect(ret.ok && ret.summary).toMatch(/deleted/i);
    expect(ret.ok && ret.summary).toContain('Broken wrist');
    expect(svc.retractFact).not.toHaveBeenCalled(); // its own operation and reason, not a retract in disguise
  });

  it('the old consent gate is gone: a stray confirmed flag changes nothing, and none is needed', async () => {
    const svc = makeFactsService();
    svc.forgetFact.mockResolvedValue(makeFact({ status: 'archived', archivedReason: 'user_deleted' }));
    const tool = buildTool(svc);

    const withFlag = outcomeOf(await tool.invoke({ operation: 'delete', factId: ID, confirmed: false }, makeConfig()));

    expect(withFlag).toMatchObject({ ok: true });
    expect(svc.forgetFact).toHaveBeenCalledTimes(1);
  });

  it('the tool description no longer makes the coach ask which one the user means, nor mentions consent or erasure', () => {
    const { description } = buildTool(makeFactsService()) as unknown as { description: string };

    expect(description).not.toMatch(/confirmed/i);
    expect(description).not.toMatch(/ask them first|erase it completely|removed entirely|no trace/i);
    expect(description).toMatch(/do not ask/i);
  });

  it('an unknown id is an llm_error', async () => {
    const svc = makeFactsService();
    svc.forgetFact.mockResolvedValue(null);
    const tool = buildTool(svc);

    const ret = outcomeOf(await tool.invoke({ operation: 'delete', factId: ID }, makeConfig()));

    expect(ret).toMatchObject({ ok: false, kind: 'llm_error' });
  });

  it('a missing fact id is an llm_error', async () => {
    const svc = makeFactsService();
    const tool = buildTool(svc);

    const ret = outcomeOf(await tool.invoke({ operation: 'delete' }, makeConfig()));

    expect(ret).toMatchObject({ ok: false, kind: 'llm_error' });
    expect(svc.forgetFact).not.toHaveBeenCalled();
  });
});

describe('manage_fact — resolving the target WITHOUT a factId (BUG-020)', () => {
  /** A stateful fake: listFacts returns the rows, retractFact archives in place. */
  function statefulService(rows: UserFact[]): jest.Mocked<IUserFactsService> {
    return {
      upsertMany: jest.fn(),
      getForPrompt: jest.fn(),
      getConstraints: jest.fn(),
      rememberFact: jest.fn(),
      confirmFact: jest.fn(),
      supersedeFact: jest.fn(),
      listFacts: jest.fn(async () => ({ active: rows.filter(r => r.status === 'active'), archived: [] })),
      forgetFact: jest.fn(async (_u: string, input: { factId: string }) => {
        const row = rows.find(r => r.id === input.factId);
        if (row === undefined) {
          return null;
        }
        row.status = 'archived';
        row.archivedReason = 'user_deleted';
        return row;
      }),
      retractFact: jest.fn(async (_u: string, input: { factId: string }) => {
        const row = rows.find(r => r.id === input.factId);
        if (row === undefined) {
          return null;
        }
        row.status = 'archived';
        return row;
      }),
    } as unknown as jest.Mocked<IUserFactsService>;
  }

  const LOWER_BACK_ID = '5b0f8a3e-1111-4111-8111-111111111111';
  const LEFT_SHOULDER_ID = '5b0f8a3e-2222-4222-8222-222222222222';
  const RIGHT_SHOULDER_ID = '5b0f8a3e-3333-4333-8333-333333333333';

  function seedRows(): UserFact[] {
    return [
      makeFact({
        id: LOWER_BACK_ID,
        category: 'physical_constraint',
        fact: 'User has a lower back injury — no direct loading of the lower back',
      }),
      makeFact({ id: LEFT_SHOULDER_ID, category: 'physical_constraint', fact: 'Left shoulder injury' }),
      makeFact({ id: RIGHT_SHOULDER_ID, category: 'physical_constraint', fact: 'Right shoulder injury' }),
    ];
  }

  it("THE MODEL'S REAL PATH: the id comes out of list_facts' rendered text and archives the fact", async () => {
    const rows = seedRows();
    const svc = statefulService(rows);
    const listTool = buildListFactsTool({ userFactsService: svc }) as unknown as InvokableTool;
    const manageTool = buildTool(svc);

    // Step 1: the model asks what is remembered.
    const listing = await listTool.invoke({}, makeConfig());
    const listingOutcome = (
      isToolReturnWithUpdate(listing as ToolReturn) ? (listing as { outcome: ToolOutcome }).outcome : listing
    ) as ToolOutcome;
    const listingText = listingOutcome.ok ? listingOutcome.summary : '';

    // Step 2: the id is parsed OUT OF THE RENDERED TEXT — never read from the fixture.
    const ids = [...listingText.matchAll(/- id ([0-9a-f-]{36}):/g)].map(m => m[1]);
    expect(ids).toContain(LOWER_BACK_ID); // the id WAS obtainable — the BUG-020 gap, closed
    const targetId = ids.find(id => id === LOWER_BACK_ID)!;

    // Step 3: retract with that id — the fact ends archived.
    const ret = outcomeOf(await manageTool.invoke({ operation: 'retract', factId: targetId }, makeConfig()));
    expect(ret).toMatchObject({ ok: true });
    expect(rows.find(r => r.id === LOWER_BACK_ID)?.status).toBe('archived');
  });

  it('retract by factQuery with ONE match archives it — no id needed', async () => {
    const rows = seedRows();
    const svc = statefulService(rows);
    const manageTool = buildTool(svc);

    const ret = outcomeOf(await manageTool.invoke({ operation: 'retract', factQuery: 'lower back' }, makeConfig()));

    expect(ret).toMatchObject({ ok: true });
    expect(svc.retractFact).toHaveBeenCalledWith('u1', { factId: LOWER_BACK_ID }, NOW);
    expect(rows.find(r => r.id === LOWER_BACK_ID)?.status).toBe('archived');
  });

  it('retract by factQuery with TWO matches lists the candidates with ids and archives NOTHING', async () => {
    const rows = seedRows();
    const svc = statefulService(rows);
    const manageTool = buildTool(svc);

    const ret = outcomeOf(await manageTool.invoke({ operation: 'retract', factQuery: 'shoulder' }, makeConfig()));

    expect(ret).toMatchObject({ ok: false, kind: 'llm_error' });
    expect(!ret.ok && ret.message).toContain(LEFT_SHOULDER_ID);
    expect(!ret.ok && ret.message).toContain(RIGHT_SHOULDER_ID);
    expect(!ret.ok && ret.message).toContain('Left shoulder injury');
    expect(svc.retractFact).not.toHaveBeenCalled();
    expect(rows.every(r => r.status === 'active')).toBe(true);
  });

  it('retract by factQuery with NO match says so — never guesses', async () => {
    const svc = statefulService(seedRows());
    const manageTool = buildTool(svc);

    const ret = outcomeOf(await manageTool.invoke({ operation: 'retract', factQuery: 'knee pain' }, makeConfig()));

    expect(ret).toMatchObject({ ok: false, kind: 'llm_error' });
    expect(svc.retractFact).not.toHaveBeenCalled();
  });

  it('delete by factQuery with ONE match archives it as user_deleted — no id, no confirmation needed', async () => {
    const rows = seedRows();
    const svc = statefulService(rows);
    const manageTool = buildTool(svc);

    const ret = outcomeOf(await manageTool.invoke({ operation: 'delete', factQuery: 'lower back' }, makeConfig()));

    expect(ret).toMatchObject({ ok: true });
    expect(svc.forgetFact).toHaveBeenCalledWith('u1', { factId: LOWER_BACK_ID }, NOW);
    expect(rows.find(r => r.id === LOWER_BACK_ID)).toMatchObject({
      status: 'archived',
      archivedReason: 'user_deleted',
    });
    expect(rows).toHaveLength(3); // nothing removed
  });

  it('delete by factQuery with TWO matches lists the candidates and forgets NOTHING', async () => {
    const rows = seedRows();
    const svc = statefulService(rows);
    const manageTool = buildTool(svc);

    const ret = outcomeOf(await manageTool.invoke({ operation: 'delete', factQuery: 'shoulder' }, makeConfig()));

    expect(ret).toMatchObject({ ok: false, kind: 'llm_error' });
    expect(svc.forgetFact).not.toHaveBeenCalled();
    expect(rows.every(r => r.status === 'active')).toBe(true);
  });

  it('neither factId nor factQuery is still the missing-id llm_error', async () => {
    const svc = statefulService(seedRows());
    const manageTool = buildTool(svc);

    const ret = outcomeOf(await manageTool.invoke({ operation: 'retract' }, makeConfig()));

    expect(ret).toMatchObject({ ok: false, kind: 'llm_error' });
    expect(svc.listFacts).not.toHaveBeenCalled();
  });
});
