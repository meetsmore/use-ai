import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { AgentPluginRunner } from '../runner';
import type {
  AgentPlugin,
  AgentPluginContext,
  AgentRunInput,
  AgentRunResult,
  ToolCallInfo,
  ToolResultInfo,
} from '../types';
import type { Logger } from '../../../logger';

/**
 * Helper to create a mock plugin context
 */
function createMockContext(overrides: Partial<AgentPluginContext> = {}): AgentPluginContext {
  return {
    runId: 'run-123',
    clientId: 'client-123',
    threadId: 'thread-123',
    provider: 'test-provider',
    events: { emit: mock(() => {}) },
    state: new Map(),
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    } as unknown as Logger,
    session: {
      clientId: 'client-123',
      threadId: 'thread-123',
      tools: [],
      state: null,
      pendingToolCalls: new Map(),
      conversationHistory: [],
      ipAddress: '127.0.0.1',
      socket: {} as never,
    },
    ...overrides,
  };
}

/**
 * Helper to create a mock run input
 */
function createMockInput(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    systemMessages: [{ role: 'system' as const, content: 'You are helpful' }],
    tools: [],
    ...overrides,
  };
}

/**
 * Helper to create a mock run result
 */
function createMockResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    text: 'Hello there!',
    response: { messages: [] },
    ...overrides,
  };
}

describe('AgentPluginRunner', () => {
  describe('constructor', () => {
    test('creates runner with empty plugins array', () => {
      const runner = new AgentPluginRunner();
      expect(runner.hasPlugins()).toBe(false);
      expect(runner.pluginCount).toBe(0);
    });

    test('creates runner with provided plugins', () => {
      const plugin1: AgentPlugin = { id: 'plugin-1' };
      const plugin2: AgentPlugin = { id: 'plugin-2' };
      const runner = new AgentPluginRunner([plugin1, plugin2]);

      expect(runner.hasPlugins()).toBe(true);
      expect(runner.pluginCount).toBe(2);
    });
  });

  describe('initialize', () => {
    test('calls initialize on all plugins', async () => {
      const initMock1 = mock(() => {});
      const initMock2 = mock(() => Promise.resolve());
      const plugin1: AgentPlugin = { id: 'plugin-1', initialize: initMock1 };
      const plugin2: AgentPlugin = { id: 'plugin-2', initialize: initMock2 };

      const runner = new AgentPluginRunner([plugin1, plugin2]);
      await runner.initialize({ provider: 'anthropic' });

      expect(initMock1).toHaveBeenCalledTimes(1);
      expect(initMock1).toHaveBeenCalledWith({ provider: 'anthropic' });
      expect(initMock2).toHaveBeenCalledTimes(1);
      expect(initMock2).toHaveBeenCalledWith({ provider: 'anthropic' });
    });

    test('skips plugins without initialize method', async () => {
      const initMock = mock(() => {});
      const plugin1: AgentPlugin = { id: 'plugin-1' };  // No initialize
      const plugin2: AgentPlugin = { id: 'plugin-2', initialize: initMock };

      const runner = new AgentPluginRunner([plugin1, plugin2]);
      await runner.initialize({ provider: 'openai' });

      expect(initMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('onUserMessage', () => {
    test('returns unchanged input when no plugins', async () => {
      const runner = new AgentPluginRunner([]);
      const input = createMockInput();
      const context = createMockContext();

      const result = await runner.onUserMessage(input, context);

      expect(result).toBe(input);
    });

    test('calls onUserMessage on all plugins in order', async () => {
      const callOrder: string[] = [];

      const plugin1: AgentPlugin = {
        id: 'plugin-1',
        onUserMessage: (input, ctx) => {
          callOrder.push('plugin-1');
          return { ...input, systemMessages: [...(input.systemMessages || []), { role: 'system' as const, content: 'Added by plugin-1' }] };
        },
      };
      const plugin2: AgentPlugin = {
        id: 'plugin-2',
        onUserMessage: (input, ctx) => {
          callOrder.push('plugin-2');
          return { ...input, systemMessages: [...(input.systemMessages || []), { role: 'system' as const, content: 'Added by plugin-2' }] };
        },
      };

      const runner = new AgentPluginRunner([plugin1, plugin2]);
      const input = createMockInput({ systemMessages: [{ role: 'system' as const, content: 'Initial' }] });
      const context = createMockContext();

      const result = await runner.onUserMessage(input, context);

      expect(callOrder).toEqual(['plugin-1', 'plugin-2']);
      expect(result.systemMessages).toEqual([
        { role: 'system', content: 'Initial' },
        { role: 'system', content: 'Added by plugin-1' },
        { role: 'system', content: 'Added by plugin-2' },
      ]);
    });

    test('chains plugin outputs', async () => {
      const plugin1: AgentPlugin = {
        id: 'plugin-1',
        onUserMessage: (input) => ({
          ...input,
          messages: [...input.messages, { role: 'assistant' as const, content: 'Added by plugin-1' }],
        }),
      };
      const plugin2: AgentPlugin = {
        id: 'plugin-2',
        onUserMessage: (input) => ({
          ...input,
          messages: [...input.messages, { role: 'user' as const, content: 'Added by plugin-2' }],
        }),
      };

      const runner = new AgentPluginRunner([plugin1, plugin2]);
      const input = createMockInput();
      const context = createMockContext();

      const result = await runner.onUserMessage(input, context);

      expect(result.messages.length).toBe(3);
      expect((result.messages[1] as { content: string }).content).toBe('Added by plugin-1');
      expect((result.messages[2] as { content: string }).content).toBe('Added by plugin-2');
    });

    test('skips plugins without onUserMessage', async () => {
      const hook = mock((input: AgentRunInput) => input);
      const plugin1: AgentPlugin = { id: 'plugin-1' };  // No hook
      const plugin2: AgentPlugin = { id: 'plugin-2', onUserMessage: hook };

      const runner = new AgentPluginRunner([plugin1, plugin2]);
      const input = createMockInput();
      const context = createMockContext();

      await runner.onUserMessage(input, context);

      expect(hook).toHaveBeenCalledTimes(1);
    });

    test('supports async onUserMessage', async () => {
      const plugin: AgentPlugin = {
        id: 'async-plugin',
        onUserMessage: async (input) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { ...input, systemMessages: [{ role: 'system' as const, content: 'Async modified' }] };
        },
      };

      const runner = new AgentPluginRunner([plugin]);
      const input = createMockInput();
      const context = createMockContext();

      const result = await runner.onUserMessage(input, context);

      expect(result.systemMessages).toEqual([{ role: 'system', content: 'Async modified' }]);
    });
  });

  describe('onAgentResponse', () => {
    test('returns unchanged result when no plugins', async () => {
      const runner = new AgentPluginRunner([]);
      const result = createMockResult();
      const context = createMockContext();

      const processed = await runner.onAgentResponse(result, context);

      expect(processed).toBe(result);
    });

    test('calls onAgentResponse on all plugins in order', async () => {
      const callOrder: string[] = [];

      const plugin1: AgentPlugin = {
        id: 'plugin-1',
        onAgentResponse: (result, ctx) => {
          callOrder.push('plugin-1');
          return { ...result, text: result.text + ' [1]' };
        },
      };
      const plugin2: AgentPlugin = {
        id: 'plugin-2',
        onAgentResponse: (result, ctx) => {
          callOrder.push('plugin-2');
          return { ...result, text: result.text + ' [2]' };
        },
      };

      const runner = new AgentPluginRunner([plugin1, plugin2]);
      const result = createMockResult({ text: 'Response' });
      const context = createMockContext();

      const processed = await runner.onAgentResponse(result, context);

      expect(callOrder).toEqual(['plugin-1', 'plugin-2']);
      expect(processed.text).toBe('Response [1] [2]');
    });

    test('supports async onAgentResponse', async () => {
      const plugin: AgentPlugin = {
        id: 'async-plugin',
        onAgentResponse: async (result) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { ...result, text: 'Async modified' };
        },
      };

      const runner = new AgentPluginRunner([plugin]);
      const result = createMockResult();
      const context = createMockContext();

      const processed = await runner.onAgentResponse(result, context);

      expect(processed.text).toBe('Async modified');
    });
  });

  describe('onTextChunk', () => {
    test('returns unchanged chunk when no plugins', async () => {
      const runner = new AgentPluginRunner([]);
      const context = createMockContext();

      const result = await runner.onTextChunk('Hello', context);

      expect(result).toBe('Hello');
    });

    test('transforms chunk through plugins', async () => {
      const plugin1: AgentPlugin = {
        id: 'plugin-1',
        onTextChunk: (chunk) => chunk.toUpperCase(),
      };
      const plugin2: AgentPlugin = {
        id: 'plugin-2',
        onTextChunk: (chunk) => `[${chunk}]`,
      };

      const runner = new AgentPluginRunner([plugin1, plugin2]);
      const context = createMockContext();

      const result = await runner.onTextChunk('hello', context);

      expect(result).toBe('[HELLO]');
    });

    test('keeps original chunk when plugin returns undefined', async () => {
      const plugin: AgentPlugin = {
        id: 'plugin-1',
        onTextChunk: (chunk) => undefined,  // Returns void
      };

      const runner = new AgentPluginRunner([plugin]);
      const context = createMockContext();

      const result = await runner.onTextChunk('unchanged', context);

      expect(result).toBe('unchanged');
    });

    test('supports async onTextChunk', async () => {
      const plugin: AgentPlugin = {
        id: 'async-plugin',
        onTextChunk: async (chunk) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return chunk + '!';
        },
      };

      const runner = new AgentPluginRunner([plugin]);
      const context = createMockContext();

      const result = await runner.onTextChunk('Hello', context);

      expect(result).toBe('Hello!');
    });
  });

  describe('onBeforeToolCall', () => {
    test('returns unchanged tool call when no plugins', async () => {
      const runner = new AgentPluginRunner([]);
      const context = createMockContext();
      const toolCall: ToolCallInfo = { id: 'call-1', name: 'test_tool', args: { value: 1 } };

      const result = await runner.onBeforeToolCall(toolCall, context);

      expect(result).toEqual(toolCall);
    });

    test('allows plugin to modify tool call', async () => {
      const plugin: AgentPlugin = {
        id: 'plugin-1',
        onBeforeToolCall: (toolCall) => ({
          ...toolCall,
          args: { ...toolCall.args as object, modified: true },
        }),
      };

      const runner = new AgentPluginRunner([plugin]);
      const context = createMockContext();
      const toolCall: ToolCallInfo = { id: 'call-1', name: 'test_tool', args: { value: 1 } };

      const result = await runner.onBeforeToolCall(toolCall, context);

      expect(result).not.toBeNull();
      expect((result!.args as { modified: boolean }).modified).toBe(true);
    });

    test('allows plugin to skip tool call by returning null', async () => {
      const plugin: AgentPlugin = {
        id: 'plugin-1',
        onBeforeToolCall: () => null,  // Skip this tool call
      };

      const runner = new AgentPluginRunner([plugin]);
      const context = createMockContext();
      const toolCall: ToolCallInfo = { id: 'call-1', name: 'test_tool', args: {} };

      const result = await runner.onBeforeToolCall(toolCall, context);

      expect(result).toBeNull();
    });

    test('stops processing when plugin returns null', async () => {
      const hook2 = mock((toolCall: ToolCallInfo) => toolCall);

      const plugin1: AgentPlugin = {
        id: 'plugin-1',
        onBeforeToolCall: () => null,
      };
      const plugin2: AgentPlugin = {
        id: 'plugin-2',
        onBeforeToolCall: hook2,
      };

      const runner = new AgentPluginRunner([plugin1, plugin2]);
      const context = createMockContext();
      const toolCall: ToolCallInfo = { id: 'call-1', name: 'test_tool', args: {} };

      await runner.onBeforeToolCall(toolCall, context);

      // Plugin 2 should not be called since plugin 1 returned null
      expect(hook2).not.toHaveBeenCalled();
    });
  });

  describe('onAfterToolCall', () => {
    test('returns unchanged result when no plugins', async () => {
      const runner = new AgentPluginRunner([]);
      const context = createMockContext();
      const toolResult: ToolResultInfo = {
        id: 'call-1',
        name: 'test_tool',
        args: {},
        result: { success: true },
      };

      const result = await runner.onAfterToolCall(toolResult, context);

      expect(result).toEqual({ success: true });
    });

    test('allows plugin to transform tool result', async () => {
      const plugin: AgentPlugin = {
        id: 'plugin-1',
        onAfterToolCall: (toolResult) => ({
          ...(toolResult.result as object),
          transformed: true,
        }),
      };

      const runner = new AgentPluginRunner([plugin]);
      const context = createMockContext();
      const toolResult: ToolResultInfo = {
        id: 'call-1',
        name: 'test_tool',
        args: {},
        result: { success: true },
      };

      const result = await runner.onAfterToolCall(toolResult, context);

      expect((result as { transformed: boolean }).transformed).toBe(true);
      expect((result as { success: boolean }).success).toBe(true);
    });

    test('chains transformed results through plugins', async () => {
      const plugin1: AgentPlugin = {
        id: 'plugin-1',
        onAfterToolCall: (toolResult) => ({
          ...(toolResult.result as object),
          addedBy1: true,
        }),
      };
      const plugin2: AgentPlugin = {
        id: 'plugin-2',
        onAfterToolCall: (toolResult) => ({
          ...(toolResult.result as object),
          addedBy2: true,
        }),
      };

      const runner = new AgentPluginRunner([plugin1, plugin2]);
      const context = createMockContext();
      const toolResult: ToolResultInfo = {
        id: 'call-1',
        name: 'test_tool',
        args: {},
        result: { original: true },
      };

      const result = await runner.onAfterToolCall(toolResult, context);

      expect((result as { addedBy1: boolean }).addedBy1).toBe(true);
      expect((result as { addedBy2: boolean }).addedBy2).toBe(true);
      expect((result as { original: boolean }).original).toBe(true);
    });
  });

  describe('destroy', () => {
    test('calls destroy on all plugins', async () => {
      const destroyMock1 = mock(() => {});
      const destroyMock2 = mock(() => Promise.resolve());

      const plugin1: AgentPlugin = { id: 'plugin-1', destroy: destroyMock1 };
      const plugin2: AgentPlugin = { id: 'plugin-2', destroy: destroyMock2 };

      const runner = new AgentPluginRunner([plugin1, plugin2]);
      await runner.destroy();

      expect(destroyMock1).toHaveBeenCalledTimes(1);
      expect(destroyMock2).toHaveBeenCalledTimes(1);
    });

    test('skips plugins without destroy method', async () => {
      const destroyMock = mock(() => {});
      const plugin1: AgentPlugin = { id: 'plugin-1' };  // No destroy
      const plugin2: AgentPlugin = { id: 'plugin-2', destroy: destroyMock };

      const runner = new AgentPluginRunner([plugin1, plugin2]);
      await runner.destroy();

      expect(destroyMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('context state sharing', () => {
    test('plugins can share state within a run', async () => {
      const plugin1: AgentPlugin = {
        id: 'plugin-1',
        onUserMessage: (input, context) => {
          context.state.set('startTime', Date.now());
          context.state.set('counter', 0);
          return input;
        },
      };
      const plugin2: AgentPlugin = {
        id: 'plugin-2',
        onUserMessage: (input, context) => {
          const counter = context.state.get('counter') as number;
          context.state.set('counter', counter + 1);
          return input;
        },
      };
      const plugin3: AgentPlugin = {
        id: 'plugin-3',
        onAgentResponse: (result, context) => {
          const startTime = context.state.get('startTime');
          const counter = context.state.get('counter');
          expect(startTime).toBeDefined();
          expect(counter).toBe(1);
          return result;
        },
      };

      const runner = new AgentPluginRunner([plugin1, plugin2, plugin3]);
      const context = createMockContext();

      await runner.onUserMessage(createMockInput(), context);
      await runner.onAgentResponse(createMockResult(), context);

      expect(context.state.get('counter')).toBe(1);
    });
  });

  describe('plugin execution order', () => {
    test('plugins execute in array order', async () => {
      const executionOrder: string[] = [];

      const createOrderPlugin = (id: string): AgentPlugin => ({
        id,
        onUserMessage: (input) => {
          executionOrder.push(`${id}:onUserMessage`);
          return input;
        },
        onAgentResponse: (result) => {
          executionOrder.push(`${id}:onAgentResponse`);
          return result;
        },
      });

      const runner = new AgentPluginRunner([
        createOrderPlugin('first'),
        createOrderPlugin('second'),
        createOrderPlugin('third'),
      ]);
      const context = createMockContext();

      await runner.onUserMessage(createMockInput(), context);
      await runner.onAgentResponse(createMockResult(), context);

      expect(executionOrder).toEqual([
        'first:onUserMessage',
        'second:onUserMessage',
        'third:onUserMessage',
        'first:onAgentResponse',
        'second:onAgentResponse',
        'third:onAgentResponse',
      ]);
    });
  });
});
