import { compose } from '@infra/ai/prompts/compose';
import type { PromptModule } from '@infra/ai/prompts/types';

import { HISTORY_FRAME_V1 } from './history-frame.v1';
import { POST_TOOL_NUDGE_V1 } from './post-tool-nudge.v1';
import { SUMMARY_FRAME_V1 } from './summary-frame.v1';
import { TOOL_RESULTS_V1 } from './tool-results.v1';

export { HISTORY_FRAME_V1, POST_TOOL_NUDGE_V1, SUMMARY_FRAME_V1, TOOL_RESULTS_V1 };
export type { HistoryFrameContext } from './history-frame.v1';
export type { SummaryFrameContext } from './summary-frame.v1';
export type { ToolResultsContext } from './tool-results.v1';

/** A block renders as one composed string — its own SystemMessage at a fixed position. */
export function renderBlock<TCtx>(module: PromptModule<TCtx>, ctx: TCtx): string {
  return compose(module.render(ctx));
}
