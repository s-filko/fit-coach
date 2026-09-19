import { z } from 'zod';

import { parseLlmBudgetOverrides, type TokenBudgetOverride } from './llm-budget-overrides';
import { type LlmProfileOverride, parseLlmProfiles } from './llm-profiles';

/**
 * Environment variables schema (config layer).
 *
 * SECURITY & ARCHITECTURE PRINCIPLES:
 * - All parameters are REQUIRED - no defaults in code
 * - All sensitive data must come from .env files only
 * - No hardcoded credentials or default values in source code
 * - Application fails fast if environment is not properly configured
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PORT: z.string().transform(v => Number(v)),
  HOST: z.string(),
  DB_HOST: z.string(),
  DB_PORT: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string(),
  BOT_API_KEY: z.string().min(1),
  TELEGRAM_TOKEN: z.string().min(1),
  // LLM Configuration — any OpenAI-compatible API (OpenAI, OpenRouter, Groq, Together, Azure, etc.)
  LLM_API_KEY: z.string().min(1),
  LLM_API_URL: z
    .string()
    .optional()
    .transform(s => (s == null || s.trim() === '' ? undefined : s))
    .pipe(z.string().url().min(1).optional()),
  LLM_MODEL: z.string().min(1),
  // Structured-output request mode for the whole LLM route (Z.AI route,
  // 2026-09-19). 'json_schema' — today's request, byte-identical. 'json_object' —
  // for providers that ignore json_schema (GLM via Z.AI): response_format
  // {type:'json_object'} plus the JSON Schema in one trailing system message.
  // Same tunables-not-secrets exception as EPISODE_*/LLM_PROFILE_*.
  LLM_STRUCTURED_OUTPUT_MODE: z.enum(['json_schema', 'json_object']).default('json_schema'),
  // Episode-memory tunables (D-L, refactor-p4-episode-memory) — the second
  // documented exception to "no defaults in code" (tunables, not secrets; same
  // class as LLM_PROFILE_*): requiring them would mean hand-editing .env.dev /
  // .env.prod before the deploy can boot.
  EPISODE_GAP_HOURS: z.coerce.number().default(3),
  EPISODE_MIN_TURNS: z.coerce.number().default(2),
  EPISODE_MIN_TOKENS: z.coerce.number().default(300),
  // AC-CC-1 (chat-continuity): every compaction trigger keeps the last N
  // turns verbatim; only what precedes the tail is summarised — a part too
  // short to summarise is kept, never dropped.
  EPISODE_KEEP_TURNS: z.coerce.number().default(6),
  // Same class as EPISODE_*/LLM_BUDGET_* above: a tunable, not a secret (P5,
  // D-A/D-12). How long a waiter for the per-userId run mutex waits before
  // rejecting with ThreadBusyError (HTTP 409).
  LLM_RUN_MUTEX_WAIT_MS: z.coerce.number().default(20000),
  LLM_TEMPERATURE: z
    .string()
    .transform(v => {
      const n = Number(v);
      if (Number.isNaN(n)) {
        throw new Error('LLM_TEMPERATURE must be a number');
      }
      return n;
    })
    .pipe(z.number().min(0).max(2)),
});

export type Env = z.infer<typeof EnvSchema> & {
  PORT: number;
  LLM_PROFILES: Record<string, LlmProfileOverride>;
  /** LLM_BUDGET_<PHASE>_<PART> — P4 context-budget plan Task 3, applied over PhaseSpec.budget. */
  LLM_BUDGETS: Record<string, TokenBudgetOverride>;
};

export function loadConfig(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(
      `Invalid environment configuration: ${issues}\n\n` +
        'Please ensure all required environment variables are set in your .env file.',
    );
  }
  const data = parsed.data as Omit<Env, 'LLM_PROFILES' | 'LLM_BUDGETS'>;
  return {
    ...data,
    PORT: data.PORT,
    LLM_PROFILES: parseLlmProfiles(process.env),
    LLM_BUDGETS: parseLlmBudgetOverrides(process.env),
  } as Env;
}
