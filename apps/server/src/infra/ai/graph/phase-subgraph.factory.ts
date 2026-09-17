/**
 * buildPhaseSubgraph (ADR-0013 §4.1, refactor-p3-phase-spec Task 3) — the one
 * factory behind every phase: `agent → (tools | finalize)`, `tools →
 * afterTools → (agent | finalize)`, `finalize → END`. A phase differs only by
 * its PhaseSpec (prompt, layout, tools, policy, loaders); adding a phase means
 * adding a spec — the graph builder is not edited (INV-LLM-005).
 */
import { END, START, StateGraph } from '@langchain/langgraph';
import { toolsCondition } from '@langchain/langgraph/prebuilt';

import type { ConversationGraphDeps, PhaseSpec } from '@infra/ai/graph/phase-spec';

import { buildAgentNode } from './nodes/agent.node';
import { buildFinalizeNode } from './nodes/finalize.node';
import { ConversationState } from './state';
import { afterTools, buildToolExecutor } from './tool-executor';

/**
 * buildPhaseSubgraph (ADR-0013 §4.1) — the one factory behind every phase:
 * `agent → (tools | finalize)`, `tools → afterTools → (agent | finalize)`,
 * `finalize → END`. The subgraph state IS the parent ConversationState
 * (refactor-p3-run-context-commit): durable channels only, run facts travel
 * as run context. Adding a phase means adding a spec (INV-LLM-005).
 */
export function buildPhaseSubgraph<D>(spec: PhaseSpec<D>, deps: ConversationGraphDeps) {
  return new StateGraph(ConversationState)
    .addNode('agent', buildAgentNode(spec, deps))
    .addNode('tools', buildToolExecutor(spec.tools, spec.toolPolicy))
    .addNode('finalize', buildFinalizeNode())
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, { tools: 'tools', [END]: 'finalize' })
    .addConditionalEdges('tools', afterTools, { agent: 'agent', [END]: 'finalize' })
    .addEdge('finalize', END)
    .compile();
}
