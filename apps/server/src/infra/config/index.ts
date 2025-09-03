import { z } from 'zod';

/**
 * Environment variables schema.
 *
 * SECURITY & ARCHITECTURE PRINCIPLES:
 * - All parameters are REQUIRED - no defaults in code
 * - All sensitive data must come from .env files only
 * - No hardcoded credentials or default values in source code
 * - Application fails fast if environment is not properly configured
 *
 * When adding new environment variables:
 * 1. Add them here as required (non-optional)
 * 2. Update all .env files (.env, .env.test, .env.production, etc.)
 * 3. Update deployment configurations
 * 4. Update documentation
 * 5. Test that application fails gracefully without the variable
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.string().transform((v) => Number(v)),
  HOST: z.string(),
  DB_HOST: z.string(),
  DB_PORT: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string(),
  BOT_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().optional(), // Optional, has defaults based on NODE_ENV
});

export type Env = z.infer<typeof EnvSchema> & { PORT: number };

export function loadConfig(): Env {
  // All environment variables must be provided - no defaults in code
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}\n\nPlease ensure all required environment variables are set in your .env file.`);
  }
  const data = parsed.data as Env;
  return { ...data, PORT: data.PORT } as Env;
}


