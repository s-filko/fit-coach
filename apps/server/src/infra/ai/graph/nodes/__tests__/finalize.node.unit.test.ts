/**
 * Shared finalize node unit tests (refactor-p3-run-context-commit): the node
 * is the validation point — the run must end with a final AIMessage that has
 * text (the agent's catalog fallback guarantees it). It returns no update:
 * responseMessage/user left the state; the reply is read by commit.
 */
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import { buildFinalizeNode } from '@infra/ai/graph/nodes/finalize.node';

describe('buildFinalizeNode (ADR-0013 §4.1)', () => {
  it('returns no update when the run ends with a text-bearing AIMessage', async () => {
    const finalize = buildFinalizeNode();

    const out = await finalize({ messages: [new HumanMessage('hi'), new AIMessage('Готово!')] });

    expect(out).toEqual({});
  });

  it('throws when the last message is not an AIMessage', async () => {
    const finalize = buildFinalizeNode();

    await expect(
      finalize({ messages: [new AIMessage('x'), new ToolMessage({ tool_call_id: 'c', content: 'r' })] }),
    ).rejects.toThrow(/final AIMessage/);
  });

  it('throws when the final AIMessage has empty text', async () => {
    const finalize = buildFinalizeNode();

    await expect(finalize({ messages: [new HumanMessage('hi'), new AIMessage('   ')] })).rejects.toThrow(
      /final AIMessage/,
    );
  });
});
