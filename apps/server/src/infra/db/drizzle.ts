import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, PoolClient } from 'pg';
import * as schema from './schema';

export const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 5433),
});

export const db = drizzle(pool, { schema });



