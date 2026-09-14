import type { ConversationRunRecord } from '@domain/conversation/ports';

import { DrizzleConversationRunService } from '@infra/conversation/drizzle-conversation-run.service';

const values = jest.fn().mockResolvedValue(undefined);
const insert = jest.fn((..._args: unknown[]) => ({ values }));

jest.mock('@infra/db/drizzle', () => ({ db: { insert: (...args: unknown[]) => insert(...args) } }));

const record: ConversationRunRecord = {
  runId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  phaseIn: 'chat',
  phaseOut: null,
  model: 'z-ai/glm-5.3',
  promptVersions: { 'phase.chat': 'v0', directives: 'v0' },
  tokensIn: 120,
  tokensOut: 40,
  latencyMs: 1500,
  toolCalls: null,
  transition: null,
  outcome: 'ok',
};

describe('DrizzleConversationRunService (AC-1301)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts one row carrying every AC-1301 field', async() => {
    await new DrizzleConversationRunService().recordRun(record);

    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: record.runId,
        userId: record.userId,
        phaseIn: 'chat',
        model: 'z-ai/glm-5.3',
        latencyMs: 1500,
        outcome: 'ok',
      }),
    );
  });
});
