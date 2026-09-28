import { toJsonSchema } from '@langchain/core/utils/json_schema';
import type { ZodType } from 'zod';

/** `JSON.parse` without the throw — `undefined` when the text is not JSON. */
export function parseJsonOrUndefined(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Extracts the JSON payload a model was supposed to return as structured output
 * but delivered as text: a Markdown code fence (```json or bare ```) first,
 * else the outermost JSON object/array embedded in prose. `undefined` when the
 * text holds no single parseable JSON value — recovery never invents data
 * (BUG-017); the caller still validates the result against the same Zod schema.
 */
export function extractJsonPayload(text: string): unknown | undefined {
  const candidates: string[] = [];

  const fenced = /```(?:json)?[^\S\n]*\n?([\s\S]*?)```/i.exec(text);
  if (fenced?.[1] !== undefined) {
    candidates.push(fenced[1]);
  }

  const starts = [text.indexOf('{'), text.indexOf('[')].filter(i => i >= 0);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (starts.length > 0 && end > Math.min(...starts)) {
    candidates.push(text.slice(Math.min(...starts), end + 1));
  }

  for (const candidate of candidates) {
    const value = parseJsonOrUndefined(candidate.trim());
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/**
 * Serialises a Zod schema to JSON Schema exactly the way `withStructuredOutput`
 * does for a non-`gpt-*` model: `cycles`/`reused` ref-packing and the response
 * format's `name` as the schema `title`. Both structured-output modes embed the
 * same serialisation — the schema travels in `response_format` (json_schema
 * mode) or in the trailing system instruction (json_object mode).
 */
function serializeToJsonSchema(schema: ZodType, name: string): Record<string, unknown> {
  return toJsonSchema(schema, {
    cycles: 'ref',
    reused: 'ref',
    override: ctx => {
      ctx.jsonSchema.title = name;
    },
  }) as Record<string, unknown>;
}

/**
 * Builds the `response_format` for `structured()` — byte-identical on the wire
 * to what `withStructuredOutput(schema, { name })` sends for a non-`gpt-*`
 * model (method `jsonSchema`), with one deliberate difference: `type` is a
 * `String` object, not a primitive.
 *
 * Why (BUG-017): in @langchain/openai 1.2.9, any response format with
 * `type === "json_schema"` is routed to `client.chat.completions.parse()`,
 * which `JSON.parse`s the content inside the OpenAI SDK. A model that answers
 * with fenced JSON (GLM via Z.AI, dev smoke 2026-09-19) makes that throw
 * `SyntaxError` before an AIMessage exists — unrecoverable — and
 * `AsyncCaller` retries it 6 extra times per gateway attempt (the smoke's two
 * summariser attempts took 621 s). An opaque `type` fails that `===` routing
 * check (so the plain `create()` path returns the raw `AIMessage`, and we
 * parse in the gateway), while `JSON.stringify` serializes it to exactly
 * `"json_schema"` — verified against the library's own bytes in
 * `llm.gateway.unit.test.ts`.
 */
export function buildJsonSchemaResponseFormat(
  schema: ZodType,
  name: string,
): {
  type: 'json_schema';
  json_schema: {
    description?: string;
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
} {
  return {
    type: new String('json_schema') as unknown as 'json_schema',
    json_schema: {
      ...(typeof schema.description === 'string' && schema.description !== ''
        ? { description: schema.description }
        : {}),
      name,
      strict: true,
      schema: serializeToJsonSchema(schema, name),
    },
  };
}

/**
 * The trailing system message text for json_object mode (`LLM_STRUCTURED_OUTPUT_MODE=json_object`)
 * — providers that ignore `response_format: json_schema` (GLM via the Z.AI
 * OpenAI-compatible endpoint accepts `text` and `json_object` only). The recipe
 * Z.AI's own docs recommend: `json_object` + the JSON Schema described in the
 * system prompt + client-side validation (the gateway's BUG-017 parse/recovery
 * already is that validation).
 */
export function buildSchemaInstruction(schema: ZodType, name: string): string {
  return `Respond with a single JSON object that conforms to this JSON Schema, and nothing else:\n${JSON.stringify(
    serializeToJsonSchema(schema, name),
  )}`;
}
