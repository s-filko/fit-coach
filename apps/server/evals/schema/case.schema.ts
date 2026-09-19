import { z } from 'zod';

import { FACT_CATEGORIES } from '@domain/user/ports';

/** Case schema — docs/PROMPT_EVAL_FRAMEWORK.md §3. */
export const EvalPhaseSchema = z.enum(['registration', 'chat', 'plan_creation', 'session_planning', 'training']);

/**
 * Mirrors the shape of the production `User` domain type
 * (src/domain/user/services/user.service.ts) closely enough that a fixture can
 * be passed straight to a prompt builder. `height`/`weight`/`age` are numbers
 * there, not strings — the plan's draft had them as strings; the real type wins.
 */
const FixtureUserSchema = z.object({
  languageCode: z.string(),
  timezone: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  age: z.number().optional(),
  gender: z.enum(['male', 'female']).optional(),
  height: z.number().optional(),
  weight: z.number().optional(),
  fitnessLevel: z.string().optional(),
  fitnessGoal: z.string().optional(),
  registrationCompleted: z.boolean().optional(),
});

/**
 * A fixture fact — the already-extracted durable row a case starts with (P6 Task 6).
 * `category` is ADR-0009's eight; `muscleGroup` is the `MuscleGroup` slug a
 * `physical_constraint` carries when hard validation must fire (AC-1361).
 */
const FixtureFactSchema = z.object({
  category: z.enum(FACT_CATEGORIES),
  fact: z.string().min(1),
  muscleGroup: z.string().nullable().optional(),
});

const FixtureSchema = z.object({
  user: FixtureUserSchema,
  hasActivePlan: z.boolean().optional(),
  plan: z.unknown().optional(),
  sessions: z.array(z.unknown()).optional(),
  activeSession: z.unknown().optional(),
  facts: z.array(FixtureFactSchema).optional(),
});

/**
 * Seed messages — the episode memory a case starts with (P4 Task 1).
 *
 * `human`/`ai` carry dialogue text; `tool_call`/`tool_result` carry the tool
 * traffic of earlier runs. Binding rule (applied by `bindSeedMessages` via
 * `parseCases`): a `tool_call` without `id` gets `seed-call-<n>` (1-based per
 * case, counting tool_call messages in order); a `tool_result` without
 * `toolCallId` binds to the most recent unbound `tool_call`.
 */
const HumanAiSeedSchema = z.object({
  role: z.enum(['human', 'ai']),
  text: z.string(),
});

const ToolCallSeedSchema = z.object({
  role: z.literal('tool_call'),
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
  id: z.string().min(1).optional(),
});

const ToolResultSeedSchema = z.object({
  role: z.literal('tool_result'),
  text: z.string(),
  toolCallId: z.string().min(1).optional(),
  status: z.enum(['ok', 'error']).optional(),
});

export const StateMessageSchema = z.discriminatedUnion('role', [
  HumanAiSeedSchema,
  ToolCallSeedSchema,
  ToolResultSeedSchema,
]);

export type StateMessage = z.infer<typeof StateMessageSchema>;

/**
 * Assigns seed ids and toolCallIds per the binding rule documented on
 * {@link StateMessageSchema}. Pure: returns a new array, input untouched.
 * A `tool_result` with no unbound `tool_call` behind it keeps no toolCallId —
 * the caller (Task 7 seeding) treats that as an orphan and skips it.
 */
export function bindSeedMessages(messages: StateMessage[]): StateMessage[] {
  const claimed = new Set<string>();
  let callIndex = 0;
  const out: StateMessage[] = [];
  for (const message of messages) {
    if (message.role === 'tool_call') {
      callIndex += 1;
      const id = message.id ?? `seed-call-${callIndex}`;
      out.push({ ...message, id });
      continue;
    }
    if (message.role === 'tool_result') {
      if (message.toolCallId !== undefined) {
        claimed.add(message.toolCallId);
        out.push(message);
        continue;
      }
      let target: string | undefined;
      for (let i = out.length - 1; i >= 0; i -= 1) {
        const prev = out[i]!;
        if (prev.role === 'tool_call' && !claimed.has(prev.id!)) {
          target = prev.id;
          break;
        }
      }
      if (target !== undefined) {
        claimed.add(target);
        out.push({ ...message, toolCallId: target });
      } else {
        out.push(message);
      }
      continue;
    }
    out.push(message);
  }
  return out;
}

const ExpectSchema = z.object({
  tools: z
    .object({
      must: z.array(z.string()).optional(),
      mustNot: z.array(z.string()).optional(),
      args: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  transition: EvalPhaseSchema.nullable().optional(),
  text: z
    .object({
      mustMatch: z.array(z.string()).optional(),
      mustNotMatch: z.array(z.string()).optional(),
      language: z.string().optional(),
      format: z.literal('telegram_html').optional(),
      maxChars: z.number().optional(),
    })
    .optional(),
  judge: z.array(z.string()).optional(),
});

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  phase: EvalPhaseSchema,
  tags: z.array(z.string()).default([]),
  deprecated: z.boolean().default(false),
  fixture: FixtureSchema,
  state: z
    .object({
      phase: EvalPhaseSchema.optional(),
      activeSessionId: z.string().nullable().optional(),
      messages: z.array(StateMessageSchema).default([]),
    })
    .optional(),
  input: z.object({ text: z.string().min(1) }),
  expect: ExpectSchema,
  provenance: z
    .object({
      runId: z.string().optional(),
      addedBy: z.string().optional(),
      date: z.string().optional(),
    })
    .optional(),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalFixture = z.infer<typeof FixtureSchema>;

export function parseCases(jsonl: string): EvalCase[] {
  const cases: EvalCase[] = [];
  const lines = jsonl.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim();
    if (!line) {
      continue;
    }
    try {
      const parsed = EvalCaseSchema.parse(JSON.parse(line));
      if (parsed.state?.messages) {
        parsed.state.messages = bindSeedMessages(parsed.state.messages);
      }
      cases.push(parsed);
    } catch (err) {
      throw new Error(`Invalid eval case at line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return cases;
}
