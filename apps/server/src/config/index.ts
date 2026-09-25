import { z } from 'zod';

import { parseLlmBudgetOverrides, type TokenBudgetOverride } from './llm-budget-overrides';
import { type LlmProfileOverride, parseLlmProfiles, REASONING_EFFORTS } from './llm-profiles';

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
  // AC-SI-5a (session-investigation-0925, BUG-038 part 1): a budget-triggered
  // compaction cuts to at most this fraction of the history budget, not
  // just-fits — without headroom, near-cap runs re-trigger compaction on
  // almost every turn (F7).
  EPISODE_BUDGET_LOW_WATER: z.coerce.number().default(0.6),
  // Same class as EPISODE_*/LLM_BUDGET_* above: a tunable, not a secret (P5,
  // D-A/D-12). How long a waiter for the per-userId run mutex waits before
  // rejecting with ThreadBusyError (HTTP 409).
  LLM_RUN_MUTEX_WAIT_MS: z.coerce.number().default(20000),
  // Course check (course-check plan Task 1, AC-FL-5): the сверка-course layer
  // on/off switch — AC-FL-7's comparison runs the same journeys with it on and
  // off. Off also stops a stored directive from rendering (the channel is
  // cleared on the next run). Backed by the `course_check` LLM profile.
  COURSE_CHECK_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform(v => v === 'true'),
  // How long a FAILED course check is not re-attempted on the same inputs
  // (minutes) — a provider outage must make the layer quieter, not cost one
  // failed call per turn. New inputs are never covered by it.
  COURSE_CHECK_RETRY_COOLDOWN_MINUTES: z.coerce.number().positive().default(15),
  // Staleness bound of the expiry question: an ask_once fact that expired MORE
  // than this many days ago is archived silently instead of asked about (a
  // months-old tweak is noise, as four-day-old soreness already is). Days, not
  // hours: short TTLs are 1-14 days, so a week past the TTL is a check-in and
  // more is history.
  COURSE_CHECK_EXPIRY_ASK_WINDOW_DAYS: z.coerce.number().positive().default(7),
  // Inference tunables (BUG-019 / AC-RL-1) — same tunables-not-secrets class as
  // EPISODE_*. GLM-5.3 always reasons and reasoning spends the same output budget,
  // so the old hard-coded 4096 cap starved the answer entirely; the cap must leave
  // room for both. 'off' omits reasoning_effort from the request for providers
  // that reject the field (e.g. Gemini via OpenRouter).
  LLM_MAX_TOKENS: z.coerce.number().int().positive().default(16384),
  LLM_REASONING_EFFORT: z.enum(REASONING_EFFORTS).default('low'),
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
  // BR-LLM-011: how long llm_calls keeps the full request/response payload before
  // the prune drops it — the row's metadata (run_id, call_index, model,
  // latency, error) is never pruned, only these two columns null out. Same
  // tunables-not-secrets class as COURSE_CHECK_EXPIRY_ASK_WINDOW_DAYS.
  LLM_CALLS_RETENTION_DAYS: z.coerce.number().positive().default(30),
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
