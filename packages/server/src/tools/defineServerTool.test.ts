import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { defineServerTool } from './defineServerTool';
import type { ServerToolContext } from './types';

describe('defineServerTool', () => {
  describe('with Zod schema', () => {
    test('creates a tool config with description and parameters from Zod schema', () => {
      const tool = defineServerTool(
        'Get weather for a city',
        z.object({ city: z.string() }),
        async ({ city }) => ({ temp: 72, city })
      );

      expect(tool.description).toBe('Get weather for a city');
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties.city).toBeDefined();
      expect(tool.execute).toBeInstanceOf(Function);
    });

    test('converts required fields from Zod schema', () => {
      const tool = defineServerTool(
        'Test',
        z.object({
          required: z.string(),
          optional: z.string().optional(),
        }),
        async (args) => args
      );

      expect(tool.parameters.required).toContain('required');
    });

    test('includes annotations when provided', () => {
      const tool = defineServerTool(
        'Delete record',
        z.object({ id: z.string() }),
        async ({ id }) => ({ deleted: id }),
        { annotations: { destructiveHint: true } }
      );

      expect(tool.annotations?.destructiveHint).toBe(true);
    });

    test('omits annotations when not provided', () => {
      const tool = defineServerTool(
        'Safe op',
        z.object({ x: z.number() }),
        async ({ x }) => x * 2
      );

      expect(tool.annotations).toBeUndefined();
    });

    test('execute function receives args and context', async () => {
      let capturedArgs: unknown;
      let capturedContext: unknown;

      const tool = defineServerTool(
        'Test',
        z.object({ value: z.string() }),
        async (args, context) => {
          capturedArgs = args;
          capturedContext = context;
          return 'ok';
        }
      );

      const mockContext = {
        session: {} as ServerToolContext['session'],
        state: null,
        runId: 'run-1',
        toolCallId: 'tc-1',
      };

      const result = await tool.execute({ value: 'hello' }, mockContext);

      expect(result).toBe('ok');
      expect(capturedArgs).toEqual({ value: 'hello' });
      expect(capturedContext).toBe(mockContext);
    });

    test('handles complex Zod schemas', () => {
      const tool = defineServerTool(
        'Complex tool',
        z.object({
          name: z.string(),
          count: z.number(),
          tags: z.array(z.string()).optional(),
        }),
        async (args) => args
      );

      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.properties.name).toBeDefined();
      expect(tool.parameters.properties.count).toBeDefined();
      expect(tool.parameters.properties.tags).toBeDefined();
    });
  });

  describe('without parameters', () => {
    test('creates a tool config with empty parameters', () => {
      const tool = defineServerTool(
        'Get server time',
        async () => new Date().toISOString()
      );

      expect(tool.description).toBe('Get server time');
      expect(tool.parameters).toEqual({ type: 'object', properties: {} });
      expect(tool.execute).toBeInstanceOf(Function);
    });

    test('supports annotations on parameterless tools', () => {
      const tool = defineServerTool(
        'Ping',
        async () => 'pong',
        { annotations: { readOnlyHint: true } }
      );

      expect(tool.annotations?.readOnlyHint).toBe(true);
    });

    test('execute function works with no args', async () => {
      const tool = defineServerTool(
        'Get time',
        async () => 'now'
      );

      const mockContext = {
        session: {} as ServerToolContext['session'],
        state: null,
        runId: 'run-1',
        toolCallId: 'tc-1',
      };

      const result = await tool.execute({}, mockContext);
      expect(result).toBe('now');
    });

    test('synchronous execute functions work', () => {
      const tool = defineServerTool(
        'Sync tool',
        () => 42
      );

      expect(tool.execute).toBeInstanceOf(Function);
    });
  });
});
