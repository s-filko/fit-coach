/**
 * `training.workout_overview` v2 (plan Task 5b, D10, AC-LP-7): the v1 render with
 * `omitTargetWeights` — sets × reps only. Loads are not planned any more: they come from LOAD
 * PLAN during training, so a legacy row's targetWeight (the DB column stays, it is simply not
 * written) is not printed either. Logged sets keep their weights — they are the record of what
 * happened, not a plan target. Selected only with the retired planner flag and the retired planner flag on
 * (training.spec.ts).
 */
import {
  buildWorkoutOverview,
  TRAINING_WORKOUT_OVERVIEW_V1,
  type TrainingWorkoutOverviewData,
} from './training-workout-overview.v1';
import type { ContextBlock, ContextBlockCtx } from './types';

export const TRAINING_WORKOUT_OVERVIEW_V2: ContextBlock<TrainingWorkoutOverviewData> = {
  id: TRAINING_WORKOUT_OVERVIEW_V1.id,
  version: 'v2',
  render(data, ctx: ContextBlockCtx) {
    return `=== WORKOUT OVERVIEW ===\n\n${buildWorkoutOverview(data.session, ctx.now, {
      recentPlacesCount: data.recentPlacesCount,
      omitTargetWeights: true,
    })}`;
  },
};
