/**
 * What the model receives is the arbiter of "no behaviour change". Captured
 * from the OLD subgraph agentNodes before infra/ai/context existed
 * (refactor-p2-context-assembler); regenerated ONCE in refactor-p3-phase-spec
 * Task 3, when the harness re-pointed at the shared buildPhaseSubgraph factory
 * (ADR-0013 §3.4 unmerged systems; §6 nudge for every phase). Since then it is
 * never regenerated except by a reviewed, enumerated diff.
 */
import { AIMessage, type BaseMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import type { ConversationGraphDeps } from '@infra/ai/graph/conversation.graph';
import { buildPhaseSubgraph } from '@infra/ai/graph/phase-subgraph.factory';
import { buildPhaseSpecs } from '@infra/ai/graph/phases';
import { getModel } from '@infra/ai/model.factory';
import { RunMetricsCollector } from '@infra/ai/run-metrics';

import {
  ASSEMBLY_SCENARIOS,
  type AssemblyScenario,
  IN_FLIGHT_POST_TOOL,
  serializeForSnapshot,
} from '../../fixtures/assembly-scenarios';
import { ACTIVE_SESSION, COMPLETE_PROFILE, EMPTY_PROFILE } from '../../fixtures/personas';
import { FIXED_NOW, FIXTURE_HISTORY, FIXTURE_SUMMARY, toUser } from '../../fixtures/prompt-contexts';
import { buildStubDeps } from '../../lib/build-stub-deps';
import type { EvalFixture } from '../../schema/case.schema';

jest.mock('@infra/ai/model.factory', () => {
  const recorded: BaseMessage[][] = [];
  const model = {
    bindTools: () => model,
    invoke: async (messages: BaseMessage[]) => {
      recorded.push(messages);
      return new AIMessage({ content: 'ok', tool_calls: [] });
    },
  };
  return { getModel: () => model, __recorded: recorded };
});

const { __recorded } = jest.requireMock('@infra/ai/model.factory') as { __recorded: BaseMessage[][] };

/** The userId buildStubDeps seeds everywhere (build-stub-deps.ts). */
const USER_ID = '22222222-2222-4222-8222-222222222222';

type PhaseName = 'registration' | 'chat' | 'plan_creation' | 'session_planning' | 'training';

interface PhaseCase {
  phase: PhaseName;
  fixture: EvalFixture;
  /** Extra subgraph input the phase needs on every scenario. */
  input?: Record<string, unknown>;
}

// Dep wiring mirrors conversation.graph.ts exactly — including the repo name
// mapping (workoutPlanRepo → workoutPlanRepository for the two builders that
// take the long names).
const PHASES: PhaseCase[] = [
  { phase: 'registration', fixture: EMPTY_PROFILE },
  { phase: 'chat', fixture: COMPLETE_PROFILE },
  { phase: 'plan_creation', fixture: COMPLETE_PROFILE },
  { phase: 'session_planning', fixture: COMPLETE_PROFILE },
  { phase: 'training', fixture: ACTIVE_SESSION, input: { activeSessionId: 'session-1' } },
];

type InvokableSubgraph = { invoke(input: unknown, config?: unknown): Promise<unknown> };

function buildSubgraph(phase: PhaseName, deps: ConversationGraphDeps): InvokableSubgraph {
  const spec = buildPhaseSpecs(deps).find(s => s.name === phase);
  if (!spec) {
    throw new Error(`No PhaseSpec for ${phase}`);
  }
  return buildPhaseSubgraph(spec, deps);
}

/**
 * Builds the stub world for one phase and runs one scenario through it,
 * returning the exact BaseMessage[] the model was invoked with.
 */
async function captureInvocation(phase: PhaseCase, scenario: AssemblyScenario): Promise<BaseMessage[]> {
  __recorded.length = 0;
  // buildStubDeps takes history as { role, text } — adapt FIXTURE_HISTORY inline.
  const { deps } = buildStubDeps(
    phase.fixture,
    FIXTURE_HISTORY.map(h => ({ role: h.role, text: h.content })),
  );
  if (scenario === 'with-summary') {
    deps.contextService.getLatestSummary = async () => FIXTURE_SUMMARY;
  }

  const subgraph = buildSubgraph(phase.phase, deps);
  // The user message is the first HumanMessage of `messages` (the adapter's
  // shape since run-context-commit); the scenario's in-flight messages follow.
  const scenarioInFlight = scenario === 'post-tool' ? IN_FLIGHT_POST_TOOL : [];
  await subgraph.invoke(
    {
      messages: [new HumanMessage('Привет, что сегодня?'), ...scenarioInFlight],
      ...(phase.input ?? {}),
    },
    {
      configurable: { thread_id: `${phase.phase}-${scenario}`, userId: USER_ID },
      metadata: { runId: 'run-snap', userId: USER_ID },
      // Run context (Task 3 Step 3): now is FIXED_NOW so `Current Date` stays
      // byte-identical under the fake timers; the user is the fixture's.
      context: {
        runId: 'run-snap',
        userId: USER_ID,
        user: toUser(phase.fixture) as never,
        now: FIXED_NOW,
        client: 'telegram' as const,
        trigger: 'user_message' as const,
        metrics: new RunMetricsCollector('run-snap'),
      },
      recursionLimit: 10,
    } as never,
  );

  expect(__recorded).toHaveLength(1);
  return __recorded[0];
}

describe('message assembly (pre-wiring truth, refactor-p2-context-assembler Task 1)', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: FIXED_NOW });
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  for (const phase of PHASES) {
    for (const scenario of ASSEMBLY_SCENARIOS) {
      it(`${phase.phase} / ${scenario}`, async () => {
        const recorded = await captureInvocation(phase, scenario);
        expect(serializeForSnapshot(recorded)).toMatchSnapshot();
      });
    }
  }

  // Registration never loads the summary — its with-summary array must be
  // byte-identical to its plain one. Cheapest proof the harness sees real
  // differences between scenarios.
  it('registration / with-summary equals plain (registration ignores the summary)', async () => {
    const plain = await captureInvocation(PHASES[0], 'plain');
    const withSummary = await captureInvocation(PHASES[0], 'with-summary');
    expect(serializeForSnapshot(withSummary)).toEqual(serializeForSnapshot(plain));
  });
});
