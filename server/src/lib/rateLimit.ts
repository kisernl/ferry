/** Small in-memory sliding-window rate limiter. One process = enough. */

export class RateLimiter {
  private hits = new Map<string, number[]>();

  /** Returns true if the action is allowed; records the hit. */
  allow(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const cutoff = now - windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  /** Periodic sweep so the map doesn't grow forever. */
  sweep(olderThanMs: number): void {
    const cutoff = Date.now() - olderThanMs;
    for (const [k, list] of this.hits) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length) this.hits.set(k, kept);
      else this.hits.delete(k);
    }
  }
}
