/**
 * Prompt-caching plan (BUG-051) T2 — AC-PC-7 (D7), run rollup persistence: `ConversationRunRecord.tokensCacheWrite`
 * (new, nullable) reaches the `conversation_runs` insert as `tokensCacheWrite`, null preserved.
 */
import type { ConversationRunRecord } from '@domain/conversation/ports';

import { DrizzleConversationRunService } from '@infra/conversation/drizzle-conversation-run.service';

const values = jest.fn().mockResolvedValue(undefined);
const insert = jest.fn((..._args: unknown[]) => ({ values }));
jest.mock('@infra/db/drizzle', () => ({ db: { insert: (...args: unknown[]) => insert(...args) } }));

const record = {
  runId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  phaseIn: 'training',
  phaseOut: null,
  trigger: 'user_message' as const,
  client: 'telegram' as const,
  model: 'anthropic/claude-sonnet-5.5',
  promptVersions: {},
  tokensIn: 20874,
  tokensOut: 40,
  tokensCached: 10302,
  tokensReasoning: null,
  latencyMs: 1500,
  toolCalls: null,
  transition: null,
  outcome: 'ok',
  budgetReport: null,
} as unknown as ConversationRunRecord;

describe('AC-PC-7: DrizzleConversationRunService persists tokensCacheWrite', () => {
  beforeEach(() => jest.clearAllMocks());

  it('AC-PC-7: the run record’s tokensCacheWrite reaches the insert', async () => {
    await new DrizzleConversationRunService().recordRun({ ...record, tokensCacheWrite: 110 } as ConversationRunRecord);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ tokensCacheWrite: 110 }));
  });

  it('AC-PC-7: null stays null (provider reported nothing)', async () => {
    await new DrizzleConversationRunService().recordRun({ ...record, tokensCacheWrite: null } as ConversationRunRecord);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ tokensCacheWrite: null }));
  });
});
