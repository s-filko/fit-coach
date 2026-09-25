/**
 * Prompt blocks (ADR-0013 §5.1 layout extension, owner-accepted 2026-09-13;
 * §3.4 blocks 2 and 3, §4.2 `contextBlocks`, D-A/D-B — P4 context-budget
 * plan Task 2). Two kinds live here:
 *  - Standalone `PromptModule`s rendered with `renderBlock` (episode
 *    summaries, the post-tool nudge) — block 2 and the mid-run nudge.
 *  - `ContextBlock<D>` domain renderers rendered with `renderBlocks` — pure
 *    renderers over a phase's `loadContext` data (block 3). Kept in the same
 *    directory as the standalone blocks, not under `context/`, so all prompt
 *    text stays inside `src/infra/ai/prompts` (BR-LLM-009 — enforced by
 *    eslint.config.js's no-restricted-syntax override and
 *    evals/levels/__tests__/no-inline-prompts.unit.test.ts).
 */
import { estimateTokens } from '@infra/ai/context/token-estimator';
import { compose } from '@infra/ai/prompts/compose';
import type { PromptModule } from '@infra/ai/prompts/types';

import { COURSE_DIRECTIVE_V1 } from './course-directive.v1';
import { EPISODE_SUMMARIES_V1 } from './episode-summaries.v1';
import { EPISODE_SUMMARIES_V2 } from './episode-summaries.v2';
import { POST_TOOL_NUDGE_V1 } from './post-tool-nudge.v1';
import type { ContextBlockCtx, RenderableBlock, RenderedBlock } from './types';
import { USER_FACTS_V1 } from './user-facts.v1';
import { USER_FACTS_V2 } from './user-facts.v2';

export {
  COURSE_DIRECTIVE_V1,
  EPISODE_SUMMARIES_V1,
  EPISODE_SUMMARIES_V2,
  POST_TOOL_NUDGE_V1,
  USER_FACTS_V1,
  USER_FACTS_V2,
};
// The current version (v2, AC-SI-5c) — every production caller renders through it.
export { episodeParagraph } from './episode-summaries.v2';
export type { EpisodeSummariesContext } from './episode-summaries.v2';
export { TIME_GAP_V1 } from './time-gap.v1';
export type { TimeGapContext } from './time-gap.v1';
export type { CourseDirectiveContext } from './course-directive.v1';
export type { UserFactsContext } from './user-facts.v2';

export type { ContextBlock, ContextBlockCtx, RenderableBlock, RenderedBlock } from './types';

export { CHAT_CONTEXT_V1, type ChatContextData } from './chat-context.v1';
export {
  buildClientProfileText,
  PLAN_CREATION_CLIENT_PROFILE_V1,
  SESSION_PLANNING_CLIENT_PROFILE_V1,
} from './client-profile.v1';
export {
  buildActivePlanSection,
  SESSION_PLANNING_ACTIVE_PLAN_V1,
  type SessionPlanningActivePlanData,
} from './session-planning-active-plan.v1';
export {
  buildHistorySection,
  SESSION_PLANNING_RECENT_HISTORY_V1,
  type SessionPlanningRecentHistoryData,
} from './session-planning-recent-history.v1';
export {
  buildRecoverySection,
  SESSION_PLANNING_RECOVERY_TIMELINE_V1,
  type SessionPlanningRecoveryTimelineData,
} from './session-planning-recovery-timeline.v1';
export {
  buildPreviousSessionSection,
  buildStaleSessionSection,
  buildWorkoutOverview,
  formatSetData,
  TRAINING_CLIENT_V1,
  TRAINING_PREVIOUS_SESSION_V1,
  TRAINING_STALE_SESSION_V1,
  TRAINING_WORKOUT_OVERVIEW_V1,
  type TrainingClientData,
  type TrainingPreviousSessionData,
  type TrainingStaleSessionData,
  type TrainingWorkoutOverviewData,
} from './training-workout-overview.v1';
export {
  TRAINING_EXERCISE_HISTORY_V1,
  TRAINING_RECENT_WORKOUTS_V1,
  type ExerciseHistoryEntry,
  type TrainingExerciseHistoryData,
  type TrainingRecentWorkoutsData,
} from './training-exercise-history.v1';

/** A block renders as one composed string — its own SystemMessage at a fixed position. */
export function renderBlock<TCtx>(module: PromptModule<TCtx>, ctx: TCtx): string {
  return compose(module.render(ctx));
}

/**
 * The default (full) depth for a block: its largest declared step, or 0 for a
 * single-depth block. Task 3's budget resolver picks a smaller step from
 * `depths` when trimming; Task 2 always renders at full depth. Takes the
 * `depths` shape structurally so both `ContextBlock<D>` (Task 2) and the
 * budget resolver's own `RenderableBlock<D>` (Task 3, ./types.ts) satisfy it.
 */
export function fullDepth(block: { depths?: readonly number[] }): number {
  return block.depths?.[0] ?? 0;
}

/**
 * Renders every domain block in spec order at `depthOf(block)` (default:
 * full depth). `null` renders are dropped — the block is absent this run
 * (e.g. no previous session). `data` is the phase's single loaded object;
 * each block reads the slice it declares via its own `D`. Takes the minimal
 * `RenderableBlock<D>` shape (./types.ts) structurally, so both
 * `ContextBlock<D>` (Task 2, which extends it) and the budget resolver's
 * narrower callers (Task 3) satisfy it.
 */
export function renderBlocks<D>(
  blocks: ReadonlyArray<RenderableBlock<D>>,
  data: D,
  ctx: ContextBlockCtx,
  depthOf: (block: RenderableBlock<D>) => number = fullDepth,
): RenderedBlock[] {
  const rendered: RenderedBlock[] = [];
  for (const block of blocks) {
    const depth = depthOf(block);
    const text = block.render(data, ctx, depth);
    if (text === null) {
      continue;
    }
    rendered.push({ id: block.id, text, tokens: estimateTokens(text), depth });
  }
  return rendered;
}
