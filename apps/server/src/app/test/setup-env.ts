import path from 'path';

import dotenv from 'dotenv';

/**
 * Load environment variables BEFORE any modules are imported
 * This runs before setupFilesAfterEnv
 */
const envFile = `.env.${process.env.NODE_ENV ?? 'test'}`;
const envPath = path.resolve(process.cwd(), envFile);

dotenv.config({ path: envPath });
