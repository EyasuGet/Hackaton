// In-memory sliding window rate limiter for channel requests (T3-019-C / T3-024-C).
// Bounded admission protecting upstream providers and maintaining per-user fairness.

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSec?: number | undefined;
}

export interface RateLimiter {
  consume(key: string): RateLimitResult;
}

export class SlidingWindowRateLimiter implements RateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #requests = new Map<string, number[]>();
  readonly #now: () => Date;

  constructor(limit = 15, windowMs = 60_000, now: () => Date = () => new Date()) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  get limit(): number {
    return this.#limit;
  }

  get windowMs(): number {
    return this.#windowMs;
  }

  consume(key: string): RateLimitResult {
    const nowMs = this.#now().getTime();
    const windowStart = nowMs - this.#windowMs;
    const existing = this.#requests.get(key) ?? [];
    const validTimestamps = existing.filter((t) => t > windowStart);

    if (validTimestamps.length >= this.#limit) {
      const oldestInWindow = validTimestamps[0]!;
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldestInWindow + this.#windowMs - nowMs) / 1000),
      );
      this.#requests.set(key, validTimestamps);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec,
      };
    }

    validTimestamps.push(nowMs);
    this.#requests.set(key, validTimestamps);

    return {
      allowed: true,
      remaining: this.#limit - validTimestamps.length,
    };
  }

  reset(): void {
    this.#requests.clear();
  }
}
