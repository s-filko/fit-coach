import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@db/schema';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env file
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

// Check required environment variables
const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

const pool = new Pool({
    host: process.env.DB_HOST,
    port: 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: false,
    // Connection pool settings
    max: 5, // Maximum number of clients in the pool
    min: 1, // Minimum number of clients in the pool
    idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
    connectionTimeoutMillis: 2000, // How long to wait for a connection
});

// Handle pool errors
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(1); // Exit process on pool error
});

// Create and export db instance
export const db = drizzle(pool, { schema });
export { pool };

// Test connection and export promise
export const dbConnectionPromise = pool.connect()
    .then(client => {
        console.log('Database connected successfully');
        client.release();
    })
    .catch(err => {
        console.error('Error connecting to the database:', err);
        process.exit(1); // Exit process on connection error
    });