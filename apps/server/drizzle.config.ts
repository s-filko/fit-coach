import path from 'path';

import dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Load appropriate .env file based on NODE_ENV
let envFile = '.env';
if (process.env.NODE_ENV === 'test') {
  envFile = '.env.test';
} else if (process.env.NODE_ENV === 'production') {
  envFile = '.env.production';
}
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

export default defineConfig({
  schema: './src/infra/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST!,
    port: Number(process.env.DB_PORT!),
    user: process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!,
    ssl: false,
  },
});
