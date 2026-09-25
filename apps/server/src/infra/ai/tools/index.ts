/**
 * Tool modules (ADR-0013 §11): one file per tool, all living in
 * src/infra/ai/tools/. Subgraphs compose the per-tool builders directly —
 * the old per-phase aggregate builders are gone. `buildSharedTools` returns
 * the tools available in every conversation phase.
 */
import type { IUserFactsService, IUserService } from '@domain/user/ports';

import { buildListFactsTool } from '@infra/ai/tools/list-facts.tool';
import { buildManageFactTool } from '@infra/ai/tools/manage-fact.tool';
import { buildSetLanguageTool } from '@infra/ai/tools/set-language.tool';
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
export { buildListFactsTool, type ListFactsToolDeps } from '@infra/ai/tools/list-facts.tool';
export { buildManageFactTool, type ManageFactToolDeps } from '@infra/ai/tools/manage-fact.tool';
export { buildSetLanguageTool, type SetLanguageToolDeps } from '@infra/ai/tools/set-language.tool';
export { buildSaveTimezoneTool, type TimezoneToolDeps } from '@infra/ai/tools/timezone.tool';
export { buildUpdateLastSetTool, type UpdateLastSetToolDeps } from '@infra/ai/tools/update-last-set.tool';
export { buildUpdateProfileTool, type UpdateProfileToolDeps } from '@infra/ai/tools/update-profile.tool';

export interface SharedToolsDeps {
  userService: IUserService;
  /** fact-lifecycle Task 2 (AC-FL-2/AC-FL-8): memory control in every phase. */
  userFacts: IUserFactsService;
}

/**
 * Tools every phase gets (ADR-0013 §11): save_timezone, set_language
 * (BUG-036 + owner language rule, R3), plus the memory tools (fact-lifecycle
 * Task 2) — listing and controlling the user's facts is not phase-specific
 * ("what do you remember about me" can come up anywhere), and neither is an
 * explicit language switch.
 */
export function buildSharedTools(deps: SharedToolsDeps) {
  return [
    buildSaveTimezoneTool(deps),
    buildSetLanguageTool(deps),
    buildManageFactTool({ userFactsService: deps.userFacts }),
    buildListFactsTool({ userFactsService: deps.userFacts }),
  ];
}
