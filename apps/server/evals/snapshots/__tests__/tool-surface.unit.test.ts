/**
 * Pre-refactor truth for refactor-p3-tool-executor. Captured from the OLD
 * per-phase tool builders before the shared executor lands; never regenerated
 * in this plan. What the model is bound to (name, description, JSON schema)
 * is the arbiter of "no tool-surface change".
 */
import type { StructuredToolInterface } from '@langchain/core/tools';
import { toJsonSchema } from '@langchain/core/utils/json_schema';

import { buildChatTools } from '@infra/ai/graph/tools/chat.tools';
import { buildPlanCreationTools } from '@infra/ai/graph/tools/plan-creation.tools';
import { buildRegistrationTools } from '@infra/ai/graph/tools/registration.tools';
import { buildSessionPlanningTools } from '@infra/ai/graph/tools/session-planning.tools';
import { buildTrainingTools } from '@infra/ai/graph/tools/training.tools';
import { buildSaveTimezoneTool } from '@infra/ai/graph/tools/timezone.tool';

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
  switch (phase) {
    case 'registration':
      return [
        ...buildRegistrationTools({ userService: deps.userService }),
        buildSaveTimezoneTool({ userService: deps.userService }),
      ];
    case 'chat':
      return [
        ...buildChatTools({ userService: deps.userService }),
        buildSaveTimezoneTool({ userService: deps.userService }),
      ];
    case 'plan_creation':
      return [
        ...buildPlanCreationTools({
          workoutPlanRepository: deps.workoutPlanRepo,
          exerciseRepository: deps.exerciseRepository,
          embeddingService: deps.embeddingService,
        }),
        buildSaveTimezoneTool({ userService: deps.userService }),
      ];
    case 'session_planning':
      return [
        ...buildSessionPlanningTools({
          trainingService: deps.trainingService,
          workoutPlanRepository: deps.workoutPlanRepo,
          exerciseRepository: deps.exerciseRepository,
          embeddingService: deps.embeddingService,
        }),
        buildSaveTimezoneTool({ userService: deps.userService }),
      ];
    case 'training':
      return [
        ...buildTrainingTools({
          trainingService: deps.trainingService,
          exerciseRepository: deps.exerciseRepository,
          embeddingService: deps.embeddingService,
        }),
        buildSaveTimezoneTool({ userService: deps.userService }),
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
