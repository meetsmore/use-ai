import { describe, expect, test, beforeEach, afterEach, spyOn } from 'bun:test';
import { Logger } from './logger';

describe('Logger (json format)', () => {
  const originalFormat = process.env.LOG_FORMAT;
  const originalSilent = process.env.LOG_SILENT;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    process.env.LOG_FORMAT = 'json';
    delete process.env.LOG_SILENT;
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (originalFormat === undefined) delete process.env.LOG_FORMAT; else process.env.LOG_FORMAT = originalFormat;
    if (originalSilent === undefined) delete process.env.LOG_SILENT; else process.env.LOG_SILENT = originalSilent;
  });

  test('data cannot replace timestamp, level or message', () => {
    const before = Date.now();
    new Logger().info('real message', { timestamp: '1999-01-01T00:00:00.000Z', level: 'error', message: 'spoofed', userId: 'user-1' });

    const entry = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('real message');
    expect(Date.parse(entry.timestamp)).toBeGreaterThanOrEqual(before - 1000);
    expect(entry.userId).toBe('user-1');
    expect(Object.keys(entry).slice(0, 3)).toEqual(['timestamp', 'level', 'message']);
  });
});
