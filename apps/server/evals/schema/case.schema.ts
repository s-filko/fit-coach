import { z } from 'zod';

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

const FixtureSchema = z.object({
  user: FixtureUserSchema,
  hasActivePlan: z.boolean().optional(),
  plan: z.unknown().optional(),
  sessions: z.array(z.unknown()).optional(),
  activeSession: z.unknown().optional(),
  facts: z.array(z.unknown()).optional(),
});

const StateMessageSchema = z.object({
  role: z.enum(['human', 'ai', 'tool_call', 'tool_result']),
  text: z.string(),
});

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
      cases.push(EvalCaseSchema.parse(JSON.parse(line)));
    } catch (err) {
      throw new Error(`Invalid eval case at line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return cases;
}
