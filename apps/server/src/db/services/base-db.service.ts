import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import * as schema from '@db/schema';

export abstract class BaseDbService {
  constructor(protected readonly db: NodePgDatabase<typeof schema>) {}

  protected async transaction<T>(callback: (tx: NodePgDatabase<typeof schema>) => Promise<T>): Promise<T> {
    return this.db.transaction(callback);
  }

  protected async withErrorHandling<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      console.error('Database operation failed:', error);
      throw error;
    }
  }
} 