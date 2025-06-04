import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL environment variable is not set');
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Connection pool settings
    max: 5, // Maximum number of clients in the pool
    min: 1, // Minimum number of clients in the pool
    idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
    connectionTimeoutMillis: 2000, // How long to wait for a connection
});

// Handle pool errors
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    // Don't exit process, just log the error
});

// Test connection
pool.connect()
    .then(client => {
        console.log('Database connected successfully');
        client.release();
    })
    .catch(err => {
        console.error('Error connecting to the database:', err);
        // Don't exit process, let the application handle the error
    });

export const db = drizzle(pool, { schema });