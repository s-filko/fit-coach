import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';

import { estimateMessages, estimateTokens, messageTokenText, TOKEN_ESTIMATOR_ID } from '../token-estimator';

describe('estimateTokens (AC-1303 L0 — shared token estimator)', () => {
  it('is chars/4 with a 1.15 safety factor, rounded up', () => {
    // 40 chars → 10 * 1.15 = 11.5 → 12
    expect(estimateTokens('a'.repeat(40))).toBe(12);
  });

  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates Cyrillic text at least as high as Latin of the same length', () => {
    const latin = estimateTokens('a'.repeat(100));
    const cyrillic = estimateTokens('я'.repeat(100));
    expect(cyrillic).toBeGreaterThanOrEqual(latin);
  });

  it('stamps its formula id', () => {
    // A BudgetReport row must say which formula produced it; changing the
    // formula means changing the id.
    expect(TOKEN_ESTIMATOR_ID).toBe('chars4x1.15');
  });
});

describe('messageTokenText / estimateMessages (the one message-level basis — budget report and compaction trigger)', () => {
  it('uses string content as is and JSON-stringifies array content', () => {
    expect(messageTokenText(new HumanMessage('hi'))).toBe('hi');
    const blocks = new HumanMessage({ content: [{ type: 'text', text: 'a' }] });
    expect(messageTokenText(blocks)).toBe(JSON.stringify(blocks.content));
  });

  it('appends an AIMessage tool_calls JSON but nothing for other roles', () => {
    const ai = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'search_workouts', args: { q: 'legs' } }],
    });
    expect(messageTokenText(ai)).toBe(JSON.stringify(ai.tool_calls));
    expect(messageTokenText(new HumanMessage('plain'))).not.toContain('tool_calls');
  });

  it('sums per message, so the report and the compaction trigger see the same number', () => {
    const messages = [
      new HumanMessage('a'.repeat(40)),
      new AIMessage({ content: 'b'.repeat(40), tool_calls: [{ id: 'c1', name: 't', args: {} }] }),
      new ToolMessage({ content: 'c'.repeat(40), tool_call_id: 'c1' }),
    ];
    // Literals, not a re-derivation: human 40 chars → 12; ai 40 chars + tool_calls
    // JSON (33 chars) → ceil(73/4 × 1.15) = 22; tool result 40 chars → 12. Total 46.
    expect(estimateMessages(messages)).toBe(46);
    expect(estimateMessages([])).toBe(0);
  });
});
