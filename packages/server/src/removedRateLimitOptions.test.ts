import { describe, expect, test, spyOn } from 'bun:test';
import { UseAIServer } from './server';
import { logger } from './logger';
import { createServerConfig } from '../test/integration-test-utils';

/** The built-in rate limits were removed. Old options must not be dropped silently. */
describe('removed rate limit options', () => {
  test('warns when the config still sets rate limits', async () => {
    const warnSpy = spyOn(logger, 'warn');
    // A JavaScript caller or a spread config gets no type error for the old options.
    const config = { ...createServerConfig(9790), rateLimitMaxRequests: 100, rateLimitWindowMs: 60_000 } as ConstructorParameters<typeof UseAIServer>[0];
    const server = new UseAIServer(config);
    try {
      const warning = warnSpy.mock.calls.find(([message]) => String(message).includes('Rate limit options were removed'));
      expect(warning).toBeDefined();
      expect(warning?.[1]).toEqual({ options: ['rateLimitMaxRequests', 'rateLimitWindowMs'] });
    } finally {
      await server.close();
      warnSpy.mockRestore();
    }
  });

  test('does not warn without them, or when they were off (0)', async () => {
    const warnSpy = spyOn(logger, 'warn');
    const server = new UseAIServer({ ...createServerConfig(9791), rateLimitMaxRequests: 0 } as ConstructorParameters<typeof UseAIServer>[0]);
    try {
      expect(warnSpy.mock.calls.some(([message]) => String(message).includes('Rate limit options were removed'))).toBe(false);
    } finally {
      await server.close();
      warnSpy.mockRestore();
    }
  });
});
