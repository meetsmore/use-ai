import { describe, expect, test, beforeEach } from 'bun:test';
import { RateLimiter } from './rateLimiter';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      maxRequests: 3,
      windowMs: 1000,
    });
  });

  test('should allow requests within limit for an IP address', () => {
    const result1 = rateLimiter.checkLimit('192.168.1.1');
    expect(result1.allowed).toBe(true);

    const result2 = rateLimiter.checkLimit('192.168.1.1');
    expect(result2.allowed).toBe(true);

    const result3 = rateLimiter.checkLimit('192.168.1.1');
    expect(result3.allowed).toBe(true);
  });

  test('should block requests exceeding limit from an IP address', () => {
    rateLimiter.checkLimit('192.168.1.1');
    rateLimiter.checkLimit('192.168.1.1');
    rateLimiter.checkLimit('192.168.1.1');

    const result = rateLimiter.checkLimit('192.168.1.1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  test('should track separate IP addresses independently', () => {
    rateLimiter.checkLimit('192.168.1.1');
    rateLimiter.checkLimit('192.168.1.1');
    rateLimiter.checkLimit('192.168.1.1');

    const result1 = rateLimiter.checkLimit('192.168.1.1');
    expect(result1.allowed).toBe(false);

    const result2 = rateLimiter.checkLimit('192.168.1.2');
    expect(result2.allowed).toBe(true);
  });

  test('should allow requests from an IP address after window expires', async () => {
    rateLimiter.checkLimit('192.168.1.1');
    rateLimiter.checkLimit('192.168.1.1');
    rateLimiter.checkLimit('192.168.1.1');

    const blocked = rateLimiter.checkLimit('192.168.1.1');
    expect(blocked.allowed).toBe(false);

    await new Promise(resolve => setTimeout(resolve, 1100));

    const allowed = rateLimiter.checkLimit('192.168.1.1');
    expect(allowed.allowed).toBe(true);
  });

  test('should remove IP address data on removeIpAddress', () => {
    rateLimiter.checkLimit('192.168.1.1');
    rateLimiter.checkLimit('192.168.1.1');
    rateLimiter.checkLimit('192.168.1.1');

    const blocked = rateLimiter.checkLimit('192.168.1.1');
    expect(blocked.allowed).toBe(false);

    rateLimiter.removeIpAddress('192.168.1.1');

    const allowed = rateLimiter.checkLimit('192.168.1.1');
    expect(allowed.allowed).toBe(true);
  });

  test('should be disabled when maxRequests is 0', () => {
    const disabledLimiter = new RateLimiter({
      maxRequests: 0,
      windowMs: 1000,
    });

    expect(disabledLimiter.isEnabled()).toBe(false);

    for (let i = 0; i < 100; i++) {
      const result = disabledLimiter.checkLimit('192.168.1.1');
      expect(result.allowed).toBe(true);
    }
  });

  test('should cleanup old requests from IP addresses', async () => {
    rateLimiter.checkLimit('192.168.1.1');

    await new Promise(resolve => setTimeout(resolve, 1100));

    rateLimiter.cleanup();

    rateLimiter.checkLimit('192.168.1.1');
    rateLimiter.checkLimit('192.168.1.1');
    rateLimiter.checkLimit('192.168.1.1');

    const allowed = rateLimiter.checkLimit('192.168.1.1');
    expect(allowed.allowed).toBe(false);
  });
});
