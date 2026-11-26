import { describe, expect, test } from 'bun:test';
import { resolveClientIp } from './clientIp';

const PEER = '172.45.17.70';

describe('resolveClientIp', () => {
  test('with 0 trusted proxies, ignores X-Forwarded-For', () => {
    expect(resolveClientIp(PEER, '198.51.100.7', 0)).toBe(PEER);
  });

  test('with 1 trusted proxy, takes the rightmost entry', () => {
    expect(resolveClientIp(PEER, '203.0.113.9, 198.51.100.7', 1)).toBe('198.51.100.7');
  });

  test('with 2 trusted proxies, takes the second entry from the right', () => {
    expect(resolveClientIp(PEER, '203.0.113.9, 198.51.100.7, 192.0.2.1', 2)).toBe('198.51.100.7');
  });

  test('with fewer entries than trusted proxies, takes the leftmost entry', () => {
    expect(resolveClientIp(PEER, '198.51.100.7', 2)).toBe('198.51.100.7');
  });

  test('without the header or with an empty one, uses the peer address', () => {
    expect(resolveClientIp(PEER, undefined, 1)).toBe(PEER);
    expect(resolveClientIp(PEER, ' , ', 1)).toBe(PEER);
  });

  test('reads a repeated header given as an array', () => {
    expect(resolveClientIp(PEER, ['203.0.113.9', '198.51.100.7'], 1)).toBe('198.51.100.7');
  });

  test('keeps an IPv6 entry as the ALB writes it', () => {
    expect(resolveClientIp(PEER, '2001:db8::1', 1)).toBe('2001:db8::1');
  });
});
