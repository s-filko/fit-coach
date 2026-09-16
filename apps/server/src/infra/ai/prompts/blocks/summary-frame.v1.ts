import type { PromptModule, Section } from '@infra/ai/prompts/types';

export interface SummaryFrameContext {
  previousSummary: string;
}

/** Row 10 — one module replaces four identical literals. */
export const SUMMARY_FRAME_V1: PromptModule<SummaryFrameContext> = {
  id: 'block.summary_frame',
  version: 'v1',
  directives: [],
  render({ previousSummary }): Section[] {
    return [{ id: 'summary_frame', required: true, text: `CONTEXT FROM PREVIOUS CONVERSATION:\n${previousSummary}` }];
  },
};
