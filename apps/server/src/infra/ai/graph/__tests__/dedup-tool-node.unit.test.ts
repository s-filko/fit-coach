import { AIMessage, ToolMessage } from '@langchain/core/messages';

import { buildDedupToolNode } from '../dedup-tool-node';

function makeToolCall(id: string, name: string, args: Record<string, unknown>) {
  return { id, name, args, type: 'tool_call' as const };
}

function makeFakeTool(name: string, invokeFn: jest.Mock) {
  return {
    name,
    invoke: invokeFn,
  };
}

function makeState(toolCalls: ReturnType<typeof makeToolCall>[]) {
  const aiMsg = new AIMessage({ content: '', tool_calls: toolCalls });
  return { messages: [aiMsg], userId: 'user-1' };
}

describe('buildDedupToolNode', () => {
  it('executes a single search_exercises call normally', async () => {
    const invoke = jest.fn().mockResolvedValue('Found 5 exercises: ...');
    const tools = [makeFakeTool('search_exercises', invoke)] as never[];
    const node = buildDedupToolNode(tools);

    const result = await node(makeState([makeToolCall('id-1', 'search_exercises', { query: 'chest barbell' })]));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.messages).toHaveLength(1);
    expect((result.messages[0] as ToolMessage).tool_call_id).toBe('id-1');
    expect((result.messages[0] as ToolMessage).content).toBe('Found 5 exercises: ...');
  });

  it('deduplicates identical search_exercises calls — invokes only once', async () => {
    const invoke = jest.fn().mockResolvedValue('Found 3 exercises: ...');
    const tools = [makeFakeTool('search_exercises', invoke)] as never[];
    const node = buildDedupToolNode(tools);

    const result = await node(
      makeState([
        makeToolCall('id-1', 'search_exercises', { query: 'chest barbell' }),
        makeToolCall('id-2', 'search_exercises', { query: 'chest barbell' }),
        makeToolCall('id-3', 'search_exercises', { query: 'chest barbell' }),
      ]),
    );

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.messages).toHaveLength(3);
    // All three tool_call_ids receive the same result
    for (const msg of result.messages) {
      expect((msg as ToolMessage).content).toBe('Found 3 exercises: ...');
    }
    expect((result.messages[0] as ToolMessage).tool_call_id).toBe('id-1');
    expect((result.messages[1] as ToolMessage).tool_call_id).toBe('id-2');
    expect((result.messages[2] as ToolMessage).tool_call_id).toBe('id-3');
  });

  it('treats different query params as distinct calls', async () => {
    const invoke = jest.fn().mockResolvedValueOnce('chest results').mockResolvedValueOnce('legs results');
    const tools = [makeFakeTool('search_exercises', invoke)] as never[];
    const node = buildDedupToolNode(tools);

    const result = await node(
      makeState([
        makeToolCall('id-1', 'search_exercises', { query: 'chest barbell' }),
        makeToolCall('id-2', 'search_exercises', { query: 'leg press machine' }),
      ]),
    );

    expect(invoke).toHaveBeenCalledTimes(2);
    expect((result.messages[0] as ToolMessage).content).toBe('chest results');
    expect((result.messages[1] as ToolMessage).content).toBe('legs results');
  });

  it('treats different filters on same query as distinct calls', async () => {
    const invoke = jest.fn().mockResolvedValue('results');
    const tools = [makeFakeTool('search_exercises', invoke)] as never[];
    const node = buildDedupToolNode(tools);

    await node(
      makeState([
        makeToolCall('id-1', 'search_exercises', { query: 'press', equipment: 'barbell' }),
        makeToolCall('id-2', 'search_exercises', { query: 'press', equipment: 'machine' }),
      ]),
    );

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('deduplicates case-insensitively and trims query whitespace', async () => {
    const invoke = jest.fn().mockResolvedValue('results');
    const tools = [makeFakeTool('search_exercises', invoke)] as never[];
    const node = buildDedupToolNode(tools);

    await node(
      makeState([
        makeToolCall('id-1', 'search_exercises', { query: 'Chest Barbell' }),
        makeToolCall('id-2', 'search_exercises', { query: '  chest barbell  ' }),
      ]),
    );

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('passes non-search_exercises tools through without dedup', async () => {
    const searchInvoke = jest.fn().mockResolvedValue('exercises');
    const saveInvoke = jest.fn().mockResolvedValue('Workout plan saved successfully!');
    const tools = [
      makeFakeTool('search_exercises', searchInvoke),
      makeFakeTool('save_workout_plan', saveInvoke),
    ] as never[];
    const node = buildDedupToolNode(tools);

    const result = await node(
      makeState([
        makeToolCall('id-1', 'search_exercises', { query: 'chest' }),
        makeToolCall('id-2', 'save_workout_plan', { name: 'My Plan' }),
      ]),
    );

    expect(searchInvoke).toHaveBeenCalledTimes(1);
    expect(saveInvoke).toHaveBeenCalledTimes(1);
    expect(result.messages).toHaveLength(2);
  });

  it('returns error ToolMessage for unknown tools', async () => {
    const tools = [] as never[];
    const node = buildDedupToolNode(tools);

    const result = await node(makeState([makeToolCall('id-1', 'unknown_tool', {})]));

    expect(result.messages).toHaveLength(1);
    expect((result.messages[0] as ToolMessage).content).toContain('Unknown tool');
    expect((result.messages[0] as ToolMessage).status).toBe('error');
  });

  it('returns error ToolMessage when tool throws', async () => {
    const invoke = jest.fn().mockRejectedValue(new Error('DB connection failed'));
    const tools = [makeFakeTool('search_exercises', invoke)] as never[];
    const node = buildDedupToolNode(tools);

    const result = await node(makeState([makeToolCall('id-1', 'search_exercises', { query: 'chest' })]));

    expect(result.messages).toHaveLength(1);
    expect((result.messages[0] as ToolMessage).content).toContain('DB connection failed');
    expect((result.messages[0] as ToolMessage).status).toBe('error');
  });
});
