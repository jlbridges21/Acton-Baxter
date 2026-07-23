type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

/**
 * In-memory rate limiter suitable for single-instance and local development.
 * Replace with Redis/Upstash in multi-instance production if needed.
 */
export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number } = { limit: 30, windowMs: 60_000 },
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + options.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: options.limit - 1, resetAt };
  }

  if (existing.count >= options.limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  buckets.set(key, existing);
  return {
    allowed: true,
    remaining: options.limit - existing.count,
    resetAt: existing.resetAt,
  };
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
