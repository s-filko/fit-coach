import { z, ZodError } from 'zod';

import { OpenAiLlmGateway } from '../llm.gateway';

const invoke = jest.fn();
const structuredInvoke = jest.fn();
const withStructuredOutput = jest.fn(() => ({ invoke: structuredInvoke }));
const getModel = jest.fn((_profile?: string) => ({ invoke, withStructuredOutput }));

jest.mock('@infra/ai/model.factory', () => ({ getModel: (profile?: string) => getModel(profile) }));

describe('OpenAiLlmGateway (ADR-0013 §7 D-10, AC-1311 — the single non-graph LLM path)', () => {
  beforeEach(() => {
    invoke.mockReset();
    structuredInvoke.mockReset();
    withStructuredOutput.mockClear();
    getModel.mockClear();
  });

  it('chat() converts ChatMsg[] to LangChain messages and returns the text content', async () => {
    invoke.mockResolvedValue({ content: 'hello there' });
    const gateway = new OpenAiLlmGateway();

    const result = await gateway.chat(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      { profile: 'summarizer', jobId: 'job-1' },
    );

    expect(result).toEqual({ content: 'hello there' });
    expect(getModel).toHaveBeenCalledWith('summarizer');
    const firstCall = invoke.mock.calls[0] ?? [];
    const [messages, config] = firstCall;
    expect(messages).toHaveLength(2);
    expect(messages[0]._getType()).toBe('system');
    expect(messages[1]._getType()).toBe('human');
    // job call: runId is present-but-undefined so a drained run is never re-opened
    expect(config.metadata).toEqual({ userId: undefined, jobId: 'job-1', runId: undefined });
    expect('runId' in config.metadata).toBe(true);
  });

  it('chat() flattens content-block arrays to text', async () => {
    invoke.mockResolvedValue({
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    });
    const result = await new OpenAiLlmGateway().chat([{ role: 'user', content: 'x' }]);
    expect(result.content).toBe('ab');
  });

  it('structured() returns the parsed object and names the schema', async () => {
    const schema = z.object({ topics: z.array(z.string()) });
    structuredInvoke.mockResolvedValue({ topics: ['legs'] });

    const result = await new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }], {
      schemaName: 'episode_summary',
    });

    expect(result).toEqual({ topics: ['legs'] });
    expect(withStructuredOutput).toHaveBeenCalledWith(schema, { name: 'episode_summary' });
  });

  it('structured() retries exactly once on a schema failure', async () => {
    const schema = z.object({ topics: z.array(z.string()) });
    structuredInvoke.mockRejectedValueOnce(new ZodError([])).mockResolvedValueOnce({ topics: ['back'] });

    const result = await new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }]);

    expect(result).toEqual({ topics: ['back'] });
    expect(structuredInvoke).toHaveBeenCalledTimes(2);
  });

  it('structured() gives up after the second schema failure', async () => {
    const schema = z.object({ topics: z.array(z.string()) });
    structuredInvoke.mockRejectedValue(new ZodError([]));

    await expect(new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(structuredInvoke).toHaveBeenCalledTimes(2);
  });

  it('structured() does not retry provider errors', async () => {
    const schema = z.object({ topics: z.array(z.string()) });
    structuredInvoke.mockRejectedValue(new Error('502 Bad Gateway'));

    await expect(new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }])).rejects.toThrow('502');
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
  });
});
