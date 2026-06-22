// assisted-by claude code claude-sonnet-4-6

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class BoundedTtlCache<V> {
  private readonly map = new Map<string, CacheEntry<V>>();

  constructor(
    private readonly maxSize: number,
    private readonly defaultTtlMs: number,
  ) {}

  /** Current number of entries (may include not-yet-evicted expired ones). */
  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh insertion order (LRU)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs?: number): void {
    if (this.map.size >= this.maxSize) {
      // Evict oldest (first insertion-order entry)
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs) });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}
