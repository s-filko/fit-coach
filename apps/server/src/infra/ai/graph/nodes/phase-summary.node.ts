import { ChatOpenAI } from '@langchain/openai';

import type { ConversationPhase, IConversationContextService } from '@domain/conversation/ports';

import { getModel } from '@infra/ai/model.factory';

import { createLogger } from '@shared/logger';

const log = createLogger('phase-summary');

const SUMMARY_SYSTEM_PROMPT = `You are a concise note-taker. Summarize the conversation below into a brief context memo (3-8 sentences).
Focus on:
- Key decisions made or agreements reached
- Important facts mentioned by the user (injuries, preferences, feedback, complaints)
- Any unfinished topics or pending actions
- Relevant numbers (weights, reps, dates, plans)

Do NOT include greetings, filler, or tool call details. Always write in English regardless of the conversation language.
If a previous summary is provided, incorporate its key points and add new information from the current conversation.`;

export async function generatePhaseSummary(
  contextService: IConversationContextService,
  userId: string,
  phase: ConversationPhase,
): Promise<void> {
  try {
    const [history, previousSummary] = await Promise.all([
      contextService.getMessagesForPrompt(userId, phase, { maxTurns: 15 }),
      contextService.getLatestSummary(userId),
    ]);

    if (history.length < 2) {
      return;
    }

    const conversationText = history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');

    const previousContext = previousSummary ? `\n\nPREVIOUS SUMMARY (from earlier phases):\n${previousSummary}\n` : '';

    const userPrompt = `${previousContext}\nCONVERSATION (phase: ${phase}):\n${conversationText}\n\nWrite a brief summary:`;

    const model: ChatOpenAI = getModel();
    const response = await model.invoke([
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]);

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
