// TODO: remove or rewrite when chat subgraph is implemented in Step 3
import { buildChatNode } from '../chat.node';

describe('buildChatNode (stub)', () => {
  it('returns a stub responseMessage', () => {
    const node = buildChatNode(null);
    const result = node();
    expect(result.responseMessage).toBeTruthy();
  });
});
