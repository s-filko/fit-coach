import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { loadConfig } from '../config/index';

const cfg = loadConfig();
export const pool = new Pool({
  host: cfg.DB_HOST,
  user: cfg.DB_USER,
  password: cfg.DB_PASSWORD,
  database: cfg.DB_NAME,
  port: Number(cfg.DB_PORT || 5432),
});

export const db = drizzle(pool, { schema });
