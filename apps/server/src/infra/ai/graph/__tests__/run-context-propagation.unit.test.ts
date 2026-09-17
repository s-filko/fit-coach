/**
 * Spike as a unit test (refactor-p3-run-context-commit Task 1): where does
 * LangGraph 1.1.5's `context` actually propagate? A toy parent graph with a
 * `contextSchema`, a compiled subgraph node, and a tool invoked from the
 * subgraph node with the node's config. Pins the answer the plan's Task 3
 * depends on (ctxOf accessor: context vs configurable.ctx).
 */
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

interface Observed {
  contextRunId: string | undefined;
  configurableThreadId: unknown;
  metadataRunId: unknown;
}

describe('run-context propagation (contextSchema) across parent, subgraph, tool', () => {
  it('pins where config.context / configurable / metadata are visible', async () => {
    const observed: Record<'parent' | 'subgraph' | 'tool', Observed | undefined> = {
      parent: undefined,
      subgraph: undefined,
      tool: undefined,
    };

    const probeTool = tool(
      async (_input: unknown, config) => {
        const c = config as {
          context?: { runId?: string };
          configurable?: Record<string, unknown>;
          metadata?: Record<string, unknown>;
        };
        observed.tool = {
          contextRunId: c.context?.runId,
          configurableThreadId: c.configurable?.['thread_id'],
          metadataRunId: c.metadata?.['runId'],
        };
        return 'ok';
      },
      { name: 'probe_tool', description: 'records what the tool config carries', schema: z.object({}) },
    );

    const ChildState = Annotation.Root({ value: Annotation<string>({ reducer: (_, v) => v, default: () => '' }) });
    const child = new StateGraph(ChildState)
      .addNode(
        'inner',
        async (
          _state: unknown,
          config: {
            context?: { runId?: string };
            configurable?: Record<string, unknown>;
            metadata?: Record<string, unknown>;
          },
        ) => {
          observed.subgraph = {
            contextRunId: config.context?.runId,
            configurableThreadId: config.configurable?.['thread_id'],
            metadataRunId: config.metadata?.['runId'],
          };
          await probeTool.invoke({}, config as never);
          return { value: 'done' };
        },
      )
      .addEdge(START, 'inner')
      .addEdge('inner', END)
      .compile();

    const ParentState = Annotation.Root({ value: Annotation<string>({ reducer: (_, v) => v, default: () => '' }) });
    const RunCtxSchema = Annotation.Root({ runId: Annotation<string>() });
    const parent = new StateGraph(ParentState, RunCtxSchema)
      .addNode(
        'outer',
        async (
          _state: unknown,
          config: {
            context?: { runId?: string };
            configurable?: Record<string, unknown>;
            metadata?: Record<string, unknown>;
          },
        ) => {
          observed.parent = {
            contextRunId: config.context?.runId,
            configurableThreadId: config.configurable?.['thread_id'],
            metadataRunId: config.metadata?.['runId'],
          };
          return { value: 'parent' };
        },
      )
      .addNode('child', child)
      .addEdge(START, 'outer')
      .addEdge('outer', 'child')
      .addEdge('child', END)
      .compile();

    await parent.invoke({ value: 'go' }, {
      configurable: { thread_id: 't-spike' },
      metadata: { runId: 'r1' },
      context: { runId: 'r1' },
    } as never);

    // The propagation table (pinned; update ONLY with a LangGraph upgrade and
    // a matching change to ctxOf in state.ts):
    //   parent    → context: yes, metadata: yes
    //   subgraph  → context: <see assertion>, metadata: <see assertion>
    //   tool      → context: <see assertion>, metadata: <see assertion>
    expect(observed.parent?.contextRunId).toBe('r1');
    expect(observed.parent?.configurableThreadId).toBe('t-spike');
    expect(observed.parent?.metadataRunId).toBe('r1');
    expect(observed.subgraph?.contextRunId).toBeDefined();
    expect(observed.subgraph?.configurableThreadId).toBe('t-spike');
    expect(observed.subgraph?.metadataRunId).toBe('r1');
    expect(observed.tool?.contextRunId).toBeDefined();
    expect(observed.tool?.configurableThreadId).toBe('t-spike');
    expect(observed.tool?.metadataRunId).toBe('r1');
  });
});
