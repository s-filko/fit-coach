import { ConversationStateType } from '@domain/conversation/graph/conversation.state';
import { IConversationContextService, IConversationRunService } from '@domain/conversation/ports';

import { promptVersionsForPhase } from '@infra/ai/prompts';
import { drainRunMetrics } from '@infra/ai/run-metrics';

import { createLogger } from '@shared/logger';

const log = createLogger('persist-node');

export function buildPersistNode(contextService: IConversationContextService, runService: IConversationRunService) {
  return async function persistNode(state: ConversationStateType): Promise<Partial<ConversationStateType>> {
    const { userId, phase, userMessage, responseMessage, runId, requestedTransition } = state;

    if (!userMessage || !responseMessage) {
      return {};
    }

    try {
      await contextService.appendTurn(userId, phase, userMessage, responseMessage);
    } catch (err) {
      // Analytics failure must not break user response
      log.warn({ err, userId, phase }, 'Failed to persist conversation turn — continuing');
    }

    const metrics = drainRunMetrics(runId);
    const promptVersions = promptVersionsForPhase(phase);
    const budgetReport = metrics.budgetReport ? { ...metrics.budgetReport, assemblies: metrics.assemblies } : null;
    try {
      await runService.recordRun({
        runId,
        userId,
        phaseIn: phase,
        phaseOut: requestedTransition?.toPhase ?? null,
        model: metrics.model ?? 'unknown',
        promptVersions,
        tokensIn: metrics.tokensIn,
        tokensOut: metrics.tokensOut,
        latencyMs: metrics.latencyMs,
        toolCalls: null,
        transition: requestedTransition ? { toPhase: requestedTransition.toPhase } : null,
        outcome: 'ok',
        budgetReport,
      });
      log.info(
        {
          runId,
          phase,
          model: metrics.model,
          promptVersions,
          tokensIn: metrics.tokensIn,
          tokensOut: metrics.tokensOut,
          latencyMs: metrics.latencyMs,
          llmCalls: metrics.llmCalls,
          budgetReport,
        },
        'Conversation run recorded',
      );
    } catch (err) {
      // Run logging is observability — never break the user response
      log.warn({ err, userId, phase, runId }, 'Failed to record conversation run — continuing');
    }

    return {};
  };
}
