/** Minimal interface shared by PendingRefMap and plain Map — used in tool deps. */
export interface IPendingRefMap<T> {
  set(key: string, value: T): void;
  get(key: string): T | undefined;
  delete(key: string): boolean;
  readonly size: number;
}

/**
 * A Map wrapper that auto-evicts stale entries on every write.
 *
 * Used for per-user closure refs shared across concurrent graph invocations.
 * If a graph execution crashes between a tool setting a value and extractNode
 * consuming it, the entry would leak. This map silently evicts entries older
 * than `ttlMs` on each `set()` call, keeping memory bounded.
 */
export class PendingRefMap<T> implements IPendingRefMap<T> {
  private readonly entries = new Map<string, { value: T; ts: number }>();
  private readonly ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  set(key: string, value: T): void {
    this.evictStale();
    this.entries.set(key, { value, ts: Date.now() });
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() - entry.ts > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  private evictStale(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.ts > this.ttlMs) {
        this.entries.delete(key);
      }
    }
  }
}
