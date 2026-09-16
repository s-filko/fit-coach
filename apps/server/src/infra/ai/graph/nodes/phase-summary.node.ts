import type { RunnableConfig } from '@langchain/core/runnables';
import { ChatOpenAI } from '@langchain/openai';

import type { ConversationPhase, IConversationContextService } from '@domain/conversation/ports';

import { getModel } from '@infra/ai/model.factory';
import { sectionText } from '@infra/ai/prompts/compose';
import { SUMMARIZER_PROMPT } from '@infra/ai/prompts/summarizer';

import { createLogger } from '@shared/logger';

const log = createLogger('phase-summary');

export async function generatePhaseSummary(
  contextService: IConversationContextService,
  userId: string,
  phase: ConversationPhase,
  config?: RunnableConfig,
): Promise<void> {
  try {
    const [history, previousSummary] = await Promise.all([
      contextService.getMessagesForPrompt(userId, phase, { maxTurns: 15 }),
      contextService.getLatestSummary(userId),
    ]);

    if (history.length < 2) {
      return;
    }

    const sections = SUMMARIZER_PROMPT.render({
      phase,
      previousSummary,
      history: history.map(m => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      })),
    });

    const model: ChatOpenAI = getModel();
    // The summary runs fire-and-forget after the transition, usually AFTER persist has
    // drained the run's metrics — so it must NOT carry the run's runId in metadata,
    // or handleChatModelStart would re-open an accumulator nobody drains (capped leak).
    // A minimal metadata with userId keeps debug logging without binding to the run.
    const response = await model.invoke(
      [
        { role: 'system', content: sectionText(sections, 'system') },
        { role: 'user', content: sectionText(sections, 'user') },
      ],
      { ...config, metadata: { userId, ...config?.metadata, runId: undefined } },
    );

    const summary =
      typeof response.content === 'string'
        ? response.content
        : (response.content as Array<{ type: string; text?: string }>)
            .filter(b => b.type === 'text')
            .map(b => b.text ?? '')
            .join('');

    if (summary.trim()) {
      await contextService.insertPhaseSummary(userId, phase, summary.trim());
      log.info({ userId, phase, summaryLength: summary.length }, 'Phase summary generated');
    }
  } catch (err) {
    log.warn({ err, userId, phase }, 'Failed to generate phase summary — continuing without it');
  }
}
