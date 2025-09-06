/**
 * Container interface for dependency injection
 * This allows app layer to use DI without importing concrete implementations
 */
export interface IContainer {
  get<T>(token: string | symbol): T;
  set<T>(token: string | symbol, value: T): void;
  has(token: string | symbol): boolean;
}

/**
 * Container tokens for dependency injection
 */
export const CONTAINER_TOKEN = Symbol('Container');
