import { ConversationState } from '@domain/conversation/graph/conversation.state';

describe('ConversationState runId channel (AC-1301)', () => {
  it('defaults runId to an empty string with a last-write reducer', () => {
    // In this LangGraph version Annotation.Root channels surface as
    // BinaryOperatorAggregate: `value` holds the default, `operator` the reducer.
    const spec = ConversationState.spec as Record<string, { value?: unknown; operator?: unknown }>;
    expect(spec['runId']).toBeDefined();
    expect(spec['runId']?.value).toBe('');
    expect(typeof spec['runId']?.operator).toBe('function');
  });
});
