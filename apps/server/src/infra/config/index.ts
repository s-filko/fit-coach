import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().transform((v) => Number(v)).optional(),
  HOST: z.string().default('0.0.0.0').optional(),
  // DB vars are optional for MVP (in-memory); will be required when DB is enabled
  DB_HOST: z.string().optional(),
  DB_PORT: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_NAME: z.string().optional(),
  BOT_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema> & { PORT: number };

export function loadConfig(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const data = parsed.data as Env;
  return { ...data, PORT: Number(process.env.PORT || 3000) } as Env;
}


