import { describe, test, expect, spyOn, afterEach } from 'bun:test';
import { Logger } from './logger';

const ENV_KEYS = ['LOG_LLM_CONTENT', 'LOG_FORMAT', 'LOG_SILENT'] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function captureLogs(env: Record<string, string>, run: (logger: Logger) => void): string {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  const spy = spyOn(console, 'log').mockImplementation(() => {});
  try {
    run(new Logger());
    return spy.mock.calls.map((args) => args.join(' ')).join('\n');
  } finally {
    spy.mockRestore();
  }
}

function logEverything(logger: Logger) {
  logger.apiRequest({
    tools: ['addTodo'],
    messageCount: 1,
    messages: [{ role: 'user', preview: 'secret prompt' }],
    systemMessages: ['secret system prompt'],
  });
  logger.aiResponse(['secret answer']);
  logger.toolCalls([{ name: 'addTodo', input: 'secret tool input' }]);
  logger.toolResult('addTodo', 'secret tool output');
  logger.toolError('addTodo', 'call-1', new Error('secret tool error'));
}

describe('Logger content logging', () => {
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  for (const format of ['pretty', 'json']) {
    test(`omits user content by default (${format})`, () => {
      const out = captureLogs({ LOG_FORMAT: format }, logEverything);
      expect(out).toContain('addTodo');
      expect(out).toContain('Tool execution failed');
      expect(out).not.toContain('secret');
    });

    test(`logs user content when LOG_LLM_CONTENT=true (${format})`, () => {
      const out = captureLogs({ LOG_FORMAT: format, LOG_LLM_CONTENT: 'true' }, logEverything);
      expect(out).toContain('secret prompt');
      expect(out).toContain('secret answer');
      expect(out).toContain('secret tool input');
      expect(out).toContain('secret tool output');
      expect(out).toContain('secret tool error');
    });
  }
});

describe('Logger JSON fields', () => {
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  test('data cannot replace timestamp, level or message', () => {
    const before = Date.now();
    const out = captureLogs({ LOG_FORMAT: 'json' }, (logger) =>
      logger.info('real message', { timestamp: '1999-01-01T00:00:00.000Z', level: 'error', message: 'spoofed', userId: 'user-1' }),
    );

    const entry = JSON.parse(out);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('real message');
    expect(Date.parse(entry.timestamp)).toBeGreaterThanOrEqual(before - 1000);
    expect(entry.userId).toBe('user-1');
    expect(Object.keys(entry).slice(0, 3)).toEqual(['timestamp', 'level', 'message']);
  });
});
