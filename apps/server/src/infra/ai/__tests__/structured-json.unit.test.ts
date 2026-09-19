import { z } from 'zod';

import { buildJsonSchemaResponseFormat, extractJsonPayload } from '../structured-json';

describe('extractJsonPayload (BUG-017 — recover JSON the model delivered as text)', () => {
  it('returns the payload from a ```json fence', () => {
    expect(extractJsonPayload('```json\n{"topics":["legs"],"summary":"ok"}\n```')).toEqual({
      topics: ['legs'],
      summary: 'ok',
    });
  });

  it('returns the payload from a bare fence (no language tag)', () => {
    expect(extractJsonPayload('```\n{"topics":["legs"]}\n```')).toEqual({ topics: ['legs'] });
  });

  it('returns the outermost JSON object embedded in prose', () => {
    expect(extractJsonPayload('Sure! Here is the summary: {"topics":["legs"],"summary":"ok"} hope it helps')).toEqual({
      topics: ['legs'],
      summary: 'ok',
    });
  });

  it('returns a top-level array', () => {
    expect(extractJsonPayload('```json\n[{"fact":"knee","category":"physical_constraint"}]\n```')).toEqual([
      { fact: 'knee', category: 'physical_constraint' },
    ]);
  });

  // The outer span is "outermost {…}/[…] of the whole text" — a broken fence in
  // front contaminates it, and recovery never invents data: no payload.
  it('returns undefined when the fence does not parse and braces span both fence and prose', () => {
    expect(extractJsonPayload('```json\n{not json}\n``` see {"topics":["legs"]} instead')).toBeUndefined();
  });

  it('returns undefined when the text contains no parseable JSON value', () => {
    expect(extractJsonPayload('topics: legs, summary: ok')).toBeUndefined();
    expect(extractJsonPayload('')).toBeUndefined();
    expect(extractJsonPayload('```json\n{not json}\n```')).toBeUndefined();
  });
});

describe('buildJsonSchemaResponseFormat (BUG-017 — same wire request, gateway-owned parsing)', () => {
  const schema = z.object({ topics: z.array(z.string()) }).describe('Episode topics');

  it('serializes to the response_format withStructuredOutput puts on the wire', () => {
    const format = buildJsonSchemaResponseFormat(schema, 'episode_summary');
    expect(JSON.parse(JSON.stringify(format))).toEqual({
      type: 'json_schema',
      json_schema: {
        description: 'Episode topics',
        name: 'episode_summary',
        strict: true,
        schema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({ topics: expect.any(Object) }),
          required: ['topics'],
        }),
      },
    });
  });

  it('omits description when the schema has none', () => {
    const bare = z.object({ topics: z.array(z.string()) });
    const format = buildJsonSchemaResponseFormat(bare, 'structured_output');
    expect(JSON.parse(JSON.stringify(format)).json_schema).not.toHaveProperty('description');
  });
});
