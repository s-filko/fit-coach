import type { ConversationRunRecord } from '@domain/conversation/ports';

/**
 * The fields every `ConversationRunRecord` literal in this directory's tests sets identically —
 * `phaseIn`/`model`/`tokensIn`/`tokensOut`/`latencyMs`/`outcome` vary per scenario, `runId`/`userId`
 * per run; everything else here does not.
 */
export const BASE_CONVERSATION_RUN_RECORD: Pick<
  ConversationRunRecord,
  'phaseOut' | 'trigger' | 'client' | 'promptVersions' | 'toolCalls' | 'transition' | 'budgetReport' | 'tokensCached' | 'tokensReasoning'
> = {
  phaseOut: null,
  trigger: 'user_message',
  client: 'telegram',
  promptVersions: {},
  toolCalls: null,
  transition: null,
  budgetReport: null,
  tokensCached: null,
  tokensReasoning: null,
};
