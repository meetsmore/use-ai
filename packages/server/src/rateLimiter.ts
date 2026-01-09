export interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private config: RateLimiterConfig;

  constructor(config: RateLimiterConfig) {
    this.config = config;
  }

  isEnabled(): boolean {
    return this.config.maxRequests > 0;
  }

  checkLimit(ipAddress: string): { allowed: boolean; retryAfterMs?: number } {
    if (!this.isEnabled()) {
      return { allowed: true };
    }

    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let timestamps = this.requests.get(ipAddress) || [];
    timestamps = timestamps.filter(ts => ts > windowStart);

    if (timestamps.length >= this.config.maxRequests) {
      const oldestRequest = timestamps[0];
      const retryAfterMs = oldestRequest + this.config.windowMs - now;
      return { allowed: false, retryAfterMs };
    }

    timestamps.push(now);
    this.requests.set(ipAddress, timestamps);

    return { allowed: true };
  }

  removeIpAddress(ipAddress: string): void {
    this.requests.delete(ipAddress);
  }

  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [ipAddress, timestamps] of this.requests.entries()) {
      const validTimestamps = timestamps.filter(ts => ts > windowStart);

      if (validTimestamps.length === 0) {
        this.requests.delete(ipAddress);
      } else {
        this.requests.set(ipAddress, validTimestamps);
      }
    }
  }
}
