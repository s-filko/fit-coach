import { z } from 'zod';

/**
 * Environment variables schema.
 *
 * IMPORTANT: All parameters in this schema are REQUIRED.
 * Do not make any parameter optional (.optional()) without explicit discussion and approval.
 * This ensures consistent environment setup across all deployment environments.
 *
 * When adding new environment variables:
 * 1. Add them here as required (non-optional)
 * 2. Update all .env files (.env, .env.test, .env.production, etc.)
 * 3. Update deployment configurations
 * 4. Update documentation
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
});

export type Env = z.infer<typeof EnvSchema> & { PORT: number };

export function loadConfig(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const data = parsed.data as Env;
  return { ...data, PORT: data.PORT } as Env;
}


