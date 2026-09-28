/**
 * buildPhaseSubgraph (ADR-0013 §4.1, refactor-p3-phase-spec Task 3) — the one
 * factory behind every phase: `agent → (tools | finalize)`, `tools →
 * afterTools → (agent | finalize | END)`, `finalize → END`. The third exit
 * (transition-handoff plan Task 1) fires when a tool batch commits a
 * transition to a configured hand-off target: the subgraph ends right there,
 * skipping `finalize` (no second model call, no final text to validate). A
 * phase differs only by its PhaseSpec (prompt, layout, tools, policy,
 * loaders); adding a phase means adding a spec — the graph builder is not
 * edited (INV-LLM-005).
 */
import { END, START, StateGraph } from '@langchain/langgraph';
import { toolsCondition } from '@langchain/langgraph/prebuilt';

import type { ConversationGraphDeps, PhaseSpec } from '@infra/ai/graph/phase-spec';

import { buildAgentNode } from './nodes/agent.node';
import { buildFinalizeNode } from './nodes/finalize.node';
import { ConversationState } from './state';
import { buildAfterTools, buildToolExecutor } from './tool-executor';

/**
 * buildPhaseSubgraph (ADR-0013 §4.1) — the one factory behind every phase:
 * `agent → (tools | finalize)`, `tools → afterTools → (agent | finalize |
 * END)`, `finalize → END`. The subgraph state IS the parent ConversationState
 * (refactor-p3-run-context-commit): durable channels only, run facts travel
 * as run context. Adding a phase means adding a spec (INV-LLM-005).
 */
export function buildPhaseSubgraph<D>(spec: PhaseSpec<D>, deps: ConversationGraphDeps) {
  const handoffTargets = deps.transitionHandoffTargets ?? new Set();
  return (
    new StateGraph(ConversationState)
      .addNode('agent', buildAgentNode(spec, deps))
      .addNode('tools', buildToolExecutor(spec.tools, spec.toolPolicy, handoffTargets))
      .addNode('finalize', buildFinalizeNode())
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', toolsCondition, { tools: 'tools', [END]: 'finalize' })
      // 'handoff' (transition-handoff plan Task 1) skips `finalize` — the hand-off
      // phase has no final text for it to validate — and ends the subgraph directly.
      .addConditionalEdges('tools', buildAfterTools(handoffTargets), {
        agent: 'agent',
        [END]: 'finalize',
        handoff: END,
      })
      .addEdge('finalize', END)
      .compile()
  );
}
