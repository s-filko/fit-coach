// DI Tokens - using unique symbols for type safety
export const TRAINING_CONTEXT_REPOSITORY_TOKEN = Symbol('TrainingContextRepository');
export const TRAINING_CONTEXT_SERVICE_TOKEN = Symbol('TrainingContextService');

// Port interfaces - domain contracts
export interface TrainingContextRepository {
  findById(id: string): Promise<unknown | null>;
  create(data: unknown): Promise<unknown>;
  update(id: string, data: Partial<unknown>): Promise<unknown | null>;
  delete(id: string): Promise<boolean>;
}

export interface TrainingContextService {
  getContext(userId: string): Promise<unknown | null>;
  createContext(userId: string, data: unknown): Promise<unknown>;
  updateContext(id: string, data: Partial<unknown>): Promise<unknown | null>;
  deleteContext(id: string): Promise<boolean>;
}
