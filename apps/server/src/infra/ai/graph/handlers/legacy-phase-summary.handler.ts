/**
 * legacyPhaseSummaryHandler (D-D): today's fire-and-forget phase summary,
 * still not awaited internally — P4 deletes it (compaction replaces it).
 */
import type { PhaseTransitionCommitted, TransitionHandler } from '@domain/conversation/events';
import type { IConversationContextService } from '@domain/conversation/ports';

import { generatePhaseSummary } from '@infra/ai/graph/nodes/phase-summary.node';

import { createLogger } from '@shared/logger';

const log = createLogger('legacy-phase-summary-handler');

export function buildLegacyPhaseSummaryHandler(contextService: IConversationContextService): TransitionHandler {
  return async (event: PhaseTransitionCommitted) => {
    // Risk (inherited from the guard): if the user sends the next message
    // before the summary completes, that message won't see it. Acceptable:
    // summaries finish in 5–10s, think-time is longer.
    generatePhaseSummary(contextService, event.userId, event.from).catch((err: unknown) =>
      log.error({ err, userId: event.userId, phase: event.from }, 'Background phase summary failed'),
    );
    return {};
  };
}
