/**
 * Shared finalize node unit tests (refactor-p3-phase-spec Task 2): today's
 * extractNode behaviour — final text out, fresh user in — with the map
 * consumption already gone.
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages';

import type { IUserService } from '@domain/user/ports';

import { buildFinalizeNode, type FinalizeNodeState } from '@infra/ai/graph/nodes/finalize.node';

const STALE_USER = { id: 'stale-user', firstName: 'Stale' };
const FRESH_USER = { id: 'fresh-user', firstName: 'Fresh' };

function makeDeps(getUser: IUserService['getUser']): { userService: IUserService } {
  return { userService: { getUser } as unknown as IUserService };
}

function makeState(overrides: Partial<FinalizeNodeState> = {}): FinalizeNodeState {
  return {
    messages: [new HumanMessage('hi'), new AIMessage('Готово!')],
    userId: 'u1',
    user: STALE_USER,
    ...overrides,
  };
}

describe('buildFinalizeNode (ADR-0013 §4.1)', () => {
  it('extracts the text of the final AI message', async () => {
    const finalize = buildFinalizeNode(makeDeps(async () => FRESH_USER));

    const out = await finalize(makeState());

    expect(out.responseMessage).toBe('Готово!');
  });

  it('flattens array-content AI messages to their text blocks', async () => {
    const finalize = buildFinalizeNode(makeDeps(async () => FRESH_USER));
    const state = makeState({
      messages: [
        new AIMessage({
          content: [
            { type: 'text', text: 'Первая часть. ' },
            { type: 'text', text: 'Вторая часть.' },
          ],
        }),
      ],
    });

    const out = await finalize(state);

    expect(out.responseMessage).toBe('Первая часть. Вторая часть.');
  });

  it('a non-AI last message yields an empty responseMessage', async () => {
    const finalize = buildFinalizeNode(makeDeps(async () => FRESH_USER));

    const out = await finalize(makeState({ messages: [new AIMessage('x'), new HumanMessage('?')] }));

    expect(out.responseMessage).toBe('');
  });

  it('the fresh user wins over the checkpointed state user', async () => {
    const getUser = jest.fn(async () => FRESH_USER);
    const finalize = buildFinalizeNode(makeDeps(getUser));

    const out = await finalize(makeState());

    expect(getUser).toHaveBeenCalledWith('u1');
    expect(out.user).toEqual(FRESH_USER);
  });

  it('a failing user fetch falls back to the state user (never throws)', async () => {
    const getUser = jest.fn(async () => {
      throw new Error('db down');
    });
    const finalize = buildFinalizeNode(makeDeps(getUser));

    const out = await finalize(makeState());

    expect(out.user).toEqual(STALE_USER);
  });

  it('no userId → no user fetch, state user passed through', async () => {
    const getUser = jest.fn(async () => FRESH_USER);
    const finalize = buildFinalizeNode(makeDeps(getUser));

    const out = await finalize(makeState({ userId: '' }));

    expect(getUser).not.toHaveBeenCalled();
    expect(out.user).toEqual(STALE_USER);
  });
});
