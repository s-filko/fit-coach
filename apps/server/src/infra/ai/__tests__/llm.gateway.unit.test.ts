import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { z, ZodError } from 'zod';

import { OpenAiLlmGateway } from '../llm.gateway';
import { buildJsonSchemaResponseFormat } from '../structured-json';

const invoke = jest.fn();
const structuredInvoke = jest.fn();
const withStructuredOutput = jest.fn();
const withConfig = jest.fn(() => ({ invoke: structuredInvoke }));
const getModel = jest.fn((_profile?: string) => ({ invoke, withConfig, withStructuredOutput }));

jest.mock('@infra/ai/model.factory', () => ({ getModel: (profile?: string) => getModel(profile) }));

jest.mock('@shared/logger', () => {
  const fns = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { createLogger: () => fns, __logFns: fns };
});
const { __logFns: logFns } = jest.requireMock('@shared/logger') as {
  __logFns: { info: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock };
};

const recoveryWarn = expect.objectContaining({ recovery: 'fenced-json' });

describe('OpenAiLlmGateway (ADR-0013 §7 D-10, AC-1311 — the single non-graph LLM path)', () => {
  beforeEach(() => {
    invoke.mockReset();
    structuredInvoke.mockReset();
    withStructuredOutput.mockReset();
    withConfig.mockClear();
    getModel.mockClear();
    logFns.info.mockClear();
    logFns.warn.mockClear();
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

  it('structured() parses a clean JSON answer and names the schema', async () => {
    const schema = z.object({ topics: z.array(z.string()) });
    structuredInvoke.mockResolvedValue({ content: '{"topics":["legs"]}' });

    const result = await new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }], {
      schemaName: 'episode_summary',
    });

    expect(result).toEqual({ topics: ['legs'] });
    expect(withConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: expect.objectContaining({
          json_schema: expect.objectContaining({ name: 'episode_summary' }),
        }),
      }),
    );
    expect(withStructuredOutput).not.toHaveBeenCalled();
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(logFns.warn).not.toHaveBeenCalledWith(recoveryWarn, expect.anything());
  });

  // BUG-017 (dev smoke 2026-09-19): the summariser answered a structured call with
  // the JSON wrapped in a ```json fence; the SDK-side parse threw SyntaxError
  // before any message existed and the blind retry answered the same way.
  it('structured() recovers ```json-fenced JSON with one model call and one warn (BUG-017)', async () => {
    const schema = z.object({ topics: z.array(z.string()) });
    structuredInvoke.mockResolvedValue({ content: '```json\n{"topics":["legs"]}\n```' });

    const result = await new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }], {
      profile: 'summarizer',
    });

    expect(result).toEqual({ topics: ['legs'] });
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(logFns.warn).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'summarizer', recovery: 'fenced-json' }),
      expect.any(String),
    );
  });

  it('structured() recovers JSON from a bare fence and from prose around the payload', async () => {
    const schema = z.object({ topics: z.array(z.string()) });

    structuredInvoke.mockResolvedValue({ content: '```\n{"topics":["back"]}\n```' });
    await expect(new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }])).resolves.toEqual({
      topics: ['back'],
    });

    structuredInvoke.mockResolvedValue({ content: 'Sure! Here: {"topics":["legs"]} hope it helps' });
    await expect(new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }])).resolves.toEqual({
      topics: ['legs'],
    });

    expect(structuredInvoke).toHaveBeenCalledTimes(2);
    expect(logFns.warn).toHaveBeenCalledTimes(2);
  });

  it('structured() recovers on the retry when only the first answer was unrecoverable', async () => {
    const schema = z.object({ topics: z.array(z.string()) });
    structuredInvoke
      .mockResolvedValueOnce({ content: 'no json here at all' })
      .mockResolvedValueOnce({ content: '```json\n{"topics":["back"]}\n```' });

    const result = await new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }]);

    expect(result).toEqual({ topics: ['back'] });
    expect(structuredInvoke).toHaveBeenCalledTimes(2);
  });

  it('structured() gives up after a schema failure and the failed retry', async () => {
    const schema = z.object({ topics: z.array(z.string()) });
    // fenced JSON that does not satisfy the schema — recovery must not invent data
    structuredInvoke.mockResolvedValue({ content: '```json\n{"topics":"not-an-array"}\n```' });

    await expect(new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }])).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(structuredInvoke).toHaveBeenCalledTimes(2);
    // no recovery happened on either attempt: the only warn is the retry one
    expect(logFns.warn).toHaveBeenCalledTimes(1);
    expect(logFns.warn).not.toHaveBeenCalledWith(recoveryWarn, expect.anything());
  });

  it('structured() does not retry provider errors', async () => {
    const schema = z.object({ topics: z.array(z.string()) });
    structuredInvoke.mockRejectedValue(new Error('502 Bad Gateway'));

    await expect(new OpenAiLlmGateway().structured(schema, [{ role: 'user', content: 'x' }])).rejects.toThrow('502');
    expect(structuredInvoke).toHaveBeenCalledTimes(1);
    expect(logFns.warn).not.toHaveBeenCalled();
  });
});

describe('structured() wire format (BUG-017 — same request, gateway-owned parsing)', () => {
  const schema = z.object({ topics: z.array(z.string()).describe('t'), summary: z.string() }).describe('A summary');
  const name = 'episode_summary';
  const validAnswer = '{"topics":["legs"],"summary":"ok"}';
  const realFetch = global.fetch;
  let bodies: string[];

  beforeEach(() => {
    bodies = [];
    const fetchStub = jest.fn(async (_url: unknown, init: { body: string }) => {
      bodies.push(init.body);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          id: 'cmpl-1',
          object: 'chat.completion',
          created: 1,
          model: 'glm-5.3',
          choices: [{ index: 0, message: { role: 'assistant', content: validAnswer }, finish_reason: 'stop' }],
        }),
      };
    });
    global.fetch = fetchStub as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const model = () => new ChatOpenAI({ model: 'glm-5.3', apiKey: 'test' });

  it('puts the byte-identical response_format on the wire as withStructuredOutput does', async () => {
    await model()
      .withStructuredOutput(schema, { name })
      .invoke([new HumanMessage('x')]);
    const [viaWithStructuredOutput] = bodies;

    await model()
      .withConfig({ response_format: buildJsonSchemaResponseFormat(schema, name) })
      .invoke([new HumanMessage('x')]);
    const [, viaGatewayFormat] = bodies;

    expect(viaGatewayFormat).toBe(viaWithStructuredOutput);
  });

  it('receives a fenced answer as a plain message with exactly one provider call', async () => {
    // the fetch stub returns the valid answer; override per-call to fence the content
    const fenced = '```json\n{"topics":["legs"],"summary":"ok"}\n```';
    (global.fetch as unknown as jest.Mock).mockImplementation(async (_url: unknown, init: { body: string }) => {
      bodies.push(init.body);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          id: 'cmpl-1',
          object: 'chat.completion',
          created: 1,
          model: 'glm-5.3',
          choices: [{ index: 0, message: { role: 'assistant', content: fenced }, finish_reason: 'stop' }],
        }),
      };
    });

    // today's pipeline throws SyntaxError inside the SDK and re-calls the provider
    // for every retry; the gateway's opaque-type format takes the create() path
    // and yields the raw message after one call
    const message = await model()
      .withConfig({ response_format: buildJsonSchemaResponseFormat(schema, name) })
      .invoke([new HumanMessage('x')]);

    expect(String(message.content)).toBe(fenced);
    expect(bodies).toHaveLength(1);
  });
});
