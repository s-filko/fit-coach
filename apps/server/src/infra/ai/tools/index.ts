/**
 * Tool modules (ADR-0013 §11): one file per tool, all living in
 * src/infra/ai/tools/. Subgraphs compose the per-tool builders directly —
 * the old per-phase aggregate builders are gone. `buildSharedTools` returns
 * the tools available in every conversation phase.
 */
import type { IUserService } from '@domain/user/ports';

import { buildSaveTimezoneTool } from '@infra/ai/tools/timezone.tool';

export {
  buildCompleteCurrentExerciseTool,
  type CompleteCurrentExerciseToolDeps,
} from '@infra/ai/tools/complete-current-exercise.tool';
export {
  buildCompleteRegistrationTool,
  type CompleteRegistrationToolDeps,
} from '@infra/ai/tools/complete-registration.tool';
export { buildDeleteLastSetsTool, type DeleteLastSetsToolDeps } from '@infra/ai/tools/delete-last-sets.tool';
export { buildFinishTrainingTool, type FinishTrainingToolDeps } from '@infra/ai/tools/finish-training.tool';
export { buildLogSetTool, type LogSetToolDeps } from '@infra/ai/tools/log-set.tool';
export { buildRequestTransitionTool, type RequestTransitionVariant } from '@infra/ai/tools/request-transition.tool';
export { buildSaveProfileFieldsTool, type SaveProfileFieldsToolDeps } from '@infra/ai/tools/save-profile-fields.tool';
export { buildSaveWorkoutPlanTool, type SaveWorkoutPlanToolDeps } from '@infra/ai/tools/save-workout-plan.tool';
export { buildSearchExercisesTool, type SearchExercisesToolDeps } from '@infra/ai/tools/search-exercises.tool';
export {
  buildStartTrainingSessionTool,
  type StartTrainingSessionToolDeps,
} from '@infra/ai/tools/start-training-session.tool';
export { buildSaveTimezoneTool, type TimezoneToolDeps } from '@infra/ai/tools/timezone.tool';
export { buildUpdateLastSetTool, type UpdateLastSetToolDeps } from '@infra/ai/tools/update-last-set.tool';
export { buildUpdateProfileTool, type UpdateProfileToolDeps } from '@infra/ai/tools/update-profile.tool';

export interface SharedToolsDeps {
  userService: IUserService;
}

/** Tools every phase gets (ADR-0013 §11): currently only save_timezone. */
export function buildSharedTools(deps: SharedToolsDeps) {
  return [buildSaveTimezoneTool(deps)];
}
