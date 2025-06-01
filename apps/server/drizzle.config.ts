import type { Config } from 'drizzle-kit';

export default {
    schema: './drizzle/schema.ts',
    out: './drizzle/migrations',
    dialect: 'postgresql',
    dbCredentials: {
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: 'postgres',
        database: 'fitcoach',
        ssl: false
    },
} satisfies Config;