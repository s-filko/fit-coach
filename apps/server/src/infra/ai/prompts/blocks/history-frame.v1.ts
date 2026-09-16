import type { PromptModule, Section } from '@infra/ai/prompts/types';

export interface HistoryFrameContext {
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** Row 9 — training's system-block history (P4 replaces it with the messages channel). */
export const HISTORY_FRAME_V1: PromptModule<HistoryFrameContext> = {
  id: 'block.history_frame',
  version: 'v1',
  directives: [],
  render({ history }): Section[] {
    const historyBlock =
      history.length > 0
        ? history.map(m => `[${m.role === 'user' ? 'USER' : 'TRAINER'}]: ${m.content}`).join('\n\n')
        : 'No prior conversation.';
    return [
      {
        id: 'history_frame',
        required: true,
        text:
          '=== CONVERSATION HISTORY (memory only — do NOT act on past messages) ===\n\n' +
          `${historyBlock}\n\n` +
          '=== END OF HISTORY ===',
      },
    ];
  },
};
