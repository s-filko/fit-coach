import { compose } from '@infra/ai/prompts/compose';
import type { PromptModule } from '@infra/ai/prompts/types';

import { EPISODE_SUMMARIES_V1 } from './episode-summaries.v1';
import { POST_TOOL_NUDGE_V1 } from './post-tool-nudge.v1';

export { EPISODE_SUMMARIES_V1, POST_TOOL_NUDGE_V1 };
export type { EpisodeSummariesContext } from './episode-summaries.v1';

/** A block renders as one composed string — its own SystemMessage at a fixed position. */
export function renderBlock<TCtx>(module: PromptModule<TCtx>, ctx: TCtx): string {
  return compose(module.render(ctx));
}
