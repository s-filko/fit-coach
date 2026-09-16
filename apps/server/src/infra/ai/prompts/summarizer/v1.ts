import type { ConversationPhase } from '@domain/conversation/ports';

import type { PromptModule, Section } from '@infra/ai/prompts/types';

export interface SummarizerContext {
  phase: ConversationPhase;
  previousSummary: string | null;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** Row 7. Two sections, consumed as two messages (system, user) — not composed into one string. */
export const SUMMARIZER_V1: PromptModule<SummarizerContext> = {
  id: 'summarizer',
  version: 'v1',
  directives: [],
  render({ phase, previousSummary, history }): Section[] {
    const conversationText = history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
    const previousContext = previousSummary ? `\n\nPREVIOUS SUMMARY (from earlier phases):\n${previousSummary}\n` : '';
    return [
      {
        id: 'system',
        required: true,
        text: `You are a concise note-taker. Summarize the conversation below into a brief context memo (3-8 sentences).
Focus on:
- Key decisions made or agreements reached
- Important facts mentioned by the user (injuries, preferences, feedback, complaints)
- Any unfinished topics or pending actions
- Relevant numbers (weights, reps, dates, plans)

Do NOT include greetings, filler, or tool call details. Always write in English regardless of the conversation language.
If a previous summary is provided, incorporate its key points and add new information from the current conversation.`,
      },
      {
        id: 'user',
        required: true,
        text: `${previousContext}\nCONVERSATION (phase: ${phase}):\n${conversationText}\n\nWrite a brief summary:`,
      },
    ];
  },
};
