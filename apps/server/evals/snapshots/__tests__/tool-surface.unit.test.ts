/**
 * Pre-refactor truth for refactor-p3-tool-executor. Captured from the OLD
 * per-phase tool builders before the shared executor lands; never regenerated
 * in this plan. What the model is bound to (name, description, JSON schema)
 * is the arbiter of "no tool-surface change".
 */
import type { StructuredToolInterface } from '@langchain/core/tools';
import { toJsonSchema } from '@langchain/core/utils/json_schema';

import {
  buildCompleteCurrentExerciseTool,
  buildCompleteRegistrationTool,
  buildDeleteLastSetsTool,
  buildFinishTrainingTool,
  buildLogSetTool,
  buildRequestTransitionTool,
  buildSaveProfileFieldsTool,
  buildSaveWorkoutPlanTool,
  buildSearchExercisesTool,
  buildSharedTools,
  buildStartTrainingSessionTool,
  buildUpdateLastSetTool,
  buildUpdateProfileTool,
} from '@infra/ai/tools';

import { COMPLETE_PROFILE } from '../../fixtures/personas';
import { buildStubDeps } from '../../lib/build-stub-deps';

type PhaseName = 'registration' | 'chat' | 'plan_creation' | 'session_planning' | 'training';

/**
 * Builds each phase's tool list exactly as its subgraph does today
 * (subgraphs/<phase>.subgraph.ts `const tools = [...]`), with inert
 * PendingRefMap dummies for the per-user maps. The stub services back the
 * closures; nothing here invokes a tool, so the fixture only needs to type-check.
 */
function phaseTools(phase: PhaseName): StructuredToolInterface[] {
  const { deps } = buildStubDeps(COMPLETE_PROFILE);
  const shared = () => buildSharedTools({ userService: deps.userService, userFacts: deps.userFacts });
  switch (phase) {
    case 'registration':
      return [
        buildSaveProfileFieldsTool({ userService: deps.userService }),
        buildCompleteRegistrationTool({ userService: deps.userService }),
        ...shared(),
      ];
    case 'chat':
      return [
        buildUpdateProfileTool({ userService: deps.userService }),
        buildRequestTransitionTool('chat'),
        ...shared(),
      ];
    case 'plan_creation':
      return [
        buildSearchExercisesTool({
          embeddingService: deps.embeddingService,
          exerciseRepository: deps.exerciseRepository,
        }),
        buildSaveWorkoutPlanTool({
          workoutPlanRepository: deps.workoutPlanRepo,
          exerciseRepository: deps.exerciseRepository,
          userFactsService: deps.userFacts,
        }),
        buildRequestTransitionTool('plan_creation'),
        ...shared(),
      ];
    case 'session_planning':
      return [
        buildSearchExercisesTool({
          embeddingService: deps.embeddingService,
          exerciseRepository: deps.exerciseRepository,
        }),
        buildStartTrainingSessionTool({
          trainingService: deps.trainingService,
          workoutPlanRepository: deps.workoutPlanRepo,
          exerciseRepository: deps.exerciseRepository,
          userFactsService: deps.userFacts,
        }),
        buildRequestTransitionTool('session_planning'),
        ...shared(),
      ];
    case 'training':
      return [
        buildSearchExercisesTool({
          embeddingService: deps.embeddingService,
          exerciseRepository: deps.exerciseRepository,
        }),
        buildLogSetTool({ trainingService: deps.trainingService }),
        buildCompleteCurrentExerciseTool({ trainingService: deps.trainingService }),
        buildFinishTrainingTool({ trainingService: deps.trainingService }),
        buildDeleteLastSetsTool({ trainingService: deps.trainingService }),
        buildUpdateLastSetTool({ trainingService: deps.trainingService }),
        ...shared(),
      ];
  }
}

const PHASES: PhaseName[] = ['registration', 'chat', 'plan_creation', 'session_planning', 'training'];

describe('tool surface (pre-executor truth, refactor-p3-tool-executor Task 1)', () => {
  for (const phase of PHASES) {
    it(`${phase} tool surface`, () => {
      const tools = phaseTools(phase);
      expect(tools.length).toBeGreaterThan(0);
      expect(
        tools.map(t => ({
          name: t.name,
          description: t.description,
          // The exact conversion @langchain/core's bindTools performs (zod v4).
          schema: toJsonSchema(t.schema),
        })),
      ).toMatchSnapshot();
    });
  }
});
