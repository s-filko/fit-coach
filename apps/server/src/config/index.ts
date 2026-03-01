import { z } from 'zod';

/**
 * Environment variables schema (config layer).
 *
 * SECURITY & ARCHITECTURE PRINCIPLES:
 * - All parameters are REQUIRED - no defaults in code
 * - All sensitive data must come from .env files only
 * - No hardcoded credentials or default values in source code
 * - Application fails fast if environment is not properly configured
 */
const EnvSchema = z.object({
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
  // LLM Configuration — any OpenAI-compatible API (OpenAI, OpenRouter, Groq, Together, Azure, etc.)
  LLM_API_KEY: z.string().min(1),
  LLM_API_URL: z
    .string()
    .optional()
    .transform(s => (s == null || s.trim() === '' ? undefined : s))
    .pipe(z.string().url().min(1).optional()),
  LLM_MODEL: z.string().min(1),
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

export type Env = z.infer<typeof EnvSchema> & { PORT: number };

export function loadConfig(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(
      `Invalid environment configuration: ${issues}\n\n` +
        'Please ensure all required environment variables are set in your .env file.',
    );
  }
  const data = parsed.data as Env;
  return { ...data, PORT: data.PORT } as Env;
}
