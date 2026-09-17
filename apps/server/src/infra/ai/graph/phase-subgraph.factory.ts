/**
 * buildPhaseSubgraph (ADR-0013 §4.1, refactor-p3-phase-spec Task 3) — the one
 * factory behind every phase: `agent → (tools | finalize)`, `tools →
 * afterTools → (agent | finalize)`, `finalize → END`. A phase differs only by
 * its PhaseSpec (prompt, layout, tools, policy, loaders); adding a phase means
 * adding a spec — the graph builder is not edited (INV-LLM-005).
 */
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { toolsCondition } from '@langchain/langgraph/prebuilt';

import type { TransitionRequest } from '@domain/conversation/graph/conversation.state';
import type { User } from '@domain/user/services/user.service';

import type { ConversationGraphDeps, PhaseSpec } from '@infra/ai/graph/phase-spec';

import { buildAgentNode } from './nodes/agent.node';
import { buildFinalizeNode } from './nodes/finalize.node';
import { afterTools, buildToolExecutor } from './tool-executor';

/**
 * The subgraph state all five phases share (today's common subgraph
 * annotation). refactor-p3-run-context-commit replaces it with the parent
 * state; `requestedTransition` is the executor-plan name of the run-context
 * `pendingTransition`.
 */
export const PhaseSubgraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  userId: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  user: Annotation<User | null>({ reducer: (_, v) => v, default: () => null }),
  userMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  responseMessage: Annotation<string>({ reducer: (_, v) => v, default: () => '' }),
  requestedTransition: Annotation<TransitionRequest | null>({ reducer: (_, v) => v, default: () => null }),
  activeSessionId: Annotation<string | null>({ reducer: (_, v) => v, default: () => null }),
});

export function buildPhaseSubgraph<D>(spec: PhaseSpec<D>, deps: ConversationGraphDeps) {
  return new StateGraph(PhaseSubgraphState)
    .addNode('agent', buildAgentNode(spec, deps))
    .addNode('tools', buildToolExecutor(spec.tools, spec.toolPolicy))
    .addNode('finalize', buildFinalizeNode(deps))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, { tools: 'tools', [END]: 'finalize' })
    .addConditionalEdges('tools', afterTools, { agent: 'agent', [END]: 'finalize' })
    .addEdge('finalize', END)
    .compile();
}
