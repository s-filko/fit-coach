import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().transform((v) => Number(v)).optional(),
  HOST: z.string().default('0.0.0.0').optional(),
  DB_HOST: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string(),
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


