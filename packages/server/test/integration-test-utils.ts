/**
 * Server Integration Test Utilities
 *
 * Shared utilities for server integration tests to reduce code duplication.
 */

import type { Socket } from 'socket.io-client';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { AISDKAgent } from '../src/agents/AISDKAgent';
import type { UseAIServerConfig } from '../src/types';
import { UseAIServer } from '../src/server';
import { createTestClient as createTestClientBase, createPollingTestClient as createPollingTestClientBase } from './test-utils';

/**
 * Helper to create streaming chunks for a text response
 */
function createTextStreamChunks(text: string) {
  return [
    { type: 'text-start' as const, id: 'text-1' },
    { type: 'text-delta' as const, id: 'text-1', delta: text },
    { type: 'text-end' as const, id: 'text-1' },
    {
      type: 'finish' as const,
      finishReason: 'stop' as const,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    },
  ];
}

/**
 * Helper to create streaming chunks for tool calls
 */
function createToolCallStreamChunks(
  toolCallId: string,
  toolName: string,
  toolInput: string
) {
  return [
    { type: 'tool-input-start' as const, id: toolCallId, toolName },
    { type: 'tool-input-delta' as const, id: toolCallId, delta: toolInput },
    { type: 'tool-input-end' as const, id: toolCallId },
    { type: 'tool-call' as const, toolCallId, toolName, input: toolInput },
    {
      type: 'finish' as const,
      finishReason: 'tool-calls' as const,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    },
  ];
}

/**
 * Helper to create a test agent with mock model
 */
export function createTestAgent(name: string = 'test-agent'): AISDKAgent {
  const mockModel = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: createTextStreamChunks('Default response'),
      }),
      response: {
        id: 'response-1',
        timestamp: new Date(),
        modelId: 'mock-model',
        headers: {},
        messages: [{ role: 'assistant', content: 'Default response' }],
      },
    }),
  });
  return new AISDKAgent({ model: mockModel });
}

/**
 * Helper to create server config with a single agent
 */
export function createServerConfig(
  port: number,
  agentName: string = 'test-agent',
  additionalConfig?: Partial<UseAIServerConfig>
): UseAIServerConfig {
  const agent = createTestAgent(agentName);
  return {
    port,
    agents: { [agentName]: agent },
    defaultAgent: agentName,
    ...additionalConfig,
  };
}

/**
 * Helper to create a mock model with custom doStream function
 */
export function createMockModel(
  doStream: (params?: unknown) => Promise<{
    stream: ReadableStream<unknown>;
    response?: {
      id?: string;
      timestamp?: Date;
      modelId?: string;
      headers?: Record<string, string>;
      messages?: Array<{ role: string; content: string | unknown[] }>;
    };
  }>
): MockLanguageModelV3 {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new MockLanguageModelV3({ doStream: doStream as any });
}

/**
 * Helper to create an agent with a custom mock model
 */
export function createAgentWithMockModel(
  doStream: (params?: unknown) => Promise<{
    stream: ReadableStream<unknown>;
    response?: {
      id?: string;
      timestamp?: Date;
      modelId?: string;
      headers?: Record<string, string>;
      messages?: Array<{ role: string; content: string | unknown[] }>;
    };
  }>
): AISDKAgent {
  const mockModel = createMockModel(doStream);
  return new AISDKAgent({ model: mockModel });
}

/**
 * Helper to create a server with a custom mock agent
 */
export function createServerWithMockAgent(
  port: number,
  doStream: (params?: unknown) => Promise<{
    stream: ReadableStream<unknown>;
    response?: {
      id?: string;
      timestamp?: Date;
      modelId?: string;
      headers?: Record<string, string>;
      messages?: Array<{ role: string; content: string | unknown[] }>;
    };
  }>,
  agentName: string = 'test-agent',
  additionalConfig?: Partial<UseAIServerConfig>
): UseAIServer {
  const agent = createAgentWithMockModel(doStream);
  return new UseAIServer({
    port,
    agents: { [agentName]: agent },
    defaultAgent: agentName,
    ...additionalConfig,
  });
}

/**
 * Server and socket cleanup manager
 */
export class TestCleanupManager {
  private servers: UseAIServer[] = [];
  private sockets: Socket[] = [];

  /**
   * Track a server for cleanup
   */
  trackServer(server: UseAIServer): void {
    this.servers.push(server);
  }

  /**
   * Track a socket for cleanup
   */
  trackSocket(socket: Socket): void {
    this.sockets.push(socket);
  }

  /**
   * Cleanup all tracked servers and sockets
   */
  cleanup(): void {
    this.servers.forEach(server => {
      try {
        server.close();
      } catch (e) {
        // Ignore errors during cleanup
      }
    });

    this.sockets.forEach(socket => {
      try {
        if (socket.connected) {
          socket.disconnect();
        }
      } catch (e) {
        // Ignore errors during cleanup
      }
    });

    this.servers = [];
    this.sockets = [];
  }

  /**
   * Create a test client (WebSocket) and track it for cleanup
   */
  async createTestClient(port: number): Promise<Socket> {
    const socket = await createTestClientBase(port);
    this.trackSocket(socket);
    return socket;
  }

  /**
   * Create a polling test client and track it for cleanup
   */
  async createPollingTestClient(port: number): Promise<Socket> {
    const socket = await createPollingTestClientBase(port);
    this.trackSocket(socket);
    return socket;
  }
}

/**
 * Mock model that returns tool calls
 */
export function createToolCallMockModel(
  toolCallId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): MockLanguageModelV3 {
  const inputStr = JSON.stringify(toolInput);
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: createToolCallStreamChunks(toolCallId, toolName, inputStr),
      }),
      response: {
        id: 'response-1',
        timestamp: new Date(),
        modelId: 'mock-model',
        headers: {},
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'tool-call', toolCallId, toolName, input: toolInput },
            ],
          },
        ],
      },
    }),
  });
}

/**
 * Mock model with sequential responses
 */
export function createSequentialMockModel(
  responses: Array<{
    text?: string;
    toolCalls?: Array<{
      toolCallId: string;
      toolName: string;
      input: Record<string, unknown>;
    }>;
  }>
): MockLanguageModelV3 {
  let callCount = 0;

  const doStream = async () => {
    const response = responses[callCount] || responses[responses.length - 1];
    callCount++;

    if (response.toolCalls && response.toolCalls.length > 0) {
      const chunks: unknown[] = [];

      if (response.text) {
        chunks.push({ type: 'text-start', id: 'text-1' });
        chunks.push({ type: 'text-delta', id: 'text-1', delta: response.text });
        chunks.push({ type: 'text-end', id: 'text-1' });
      }

      // Stream all tool calls
      for (const tc of response.toolCalls) {
        const inputStr = JSON.stringify(tc.input);
        chunks.push(
          { type: 'tool-input-start', id: tc.toolCallId, toolName: tc.toolName },
          { type: 'tool-input-delta', id: tc.toolCallId, delta: inputStr },
          { type: 'tool-input-end', id: tc.toolCallId },
          { type: 'tool-call', toolCallId: tc.toolCallId, toolName: tc.toolName, input: inputStr }
        );
      }

      chunks.push({
        type: 'finish',
        finishReason: 'tool-calls',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      });

      const content: unknown[] = response.toolCalls.map(t => ({
        type: 'tool-call',
        toolCallId: t.toolCallId,
        toolName: t.toolName,
        input: t.input,
      }));
      if (response.text) {
        content.unshift({ type: 'text', text: response.text });
      }

      return {
        stream: simulateReadableStream({ chunks }),
        response: {
          id: 'response-1',
          timestamp: new Date(),
          modelId: 'mock-model',
          headers: {},
          messages: [{ role: 'assistant', content }],
        },
      };
    }

    return {
      stream: simulateReadableStream({
        chunks: createTextStreamChunks(response.text || ''),
      }),
      response: {
        id: 'response-1',
        timestamp: new Date(),
        modelId: 'mock-model',
        headers: {},
        messages: [{ role: 'assistant', content: response.text || '' }],
      },
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new MockLanguageModelV3({ doStream: doStream as any });
}

/**
 * Mock model that throws an error
 */
export function createErrorMockModel(errorMessage: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => {
      throw new Error(errorMessage);
    },
  });
}

/**
 * Mock model that validates system prompts
 */
export function createSystemPromptValidatorMockModel(
  validator: (messages: unknown[]) => void
): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async (params?: unknown) => {
      const messages = (params as { prompt?: unknown[] })?.prompt || [];
      validator(messages);

      return {
        stream: simulateReadableStream({
          chunks: createTextStreamChunks('OK'),
        }),
        response: {
          id: 'response-1',
          timestamp: new Date(),
          modelId: 'mock-model',
          headers: {},
          messages: [{ role: 'assistant', content: 'OK' }],
        },
      };
    },
  });
}

/**
 * Mock model that validates tools
 */
export function createToolValidatorMockModel(
  validator: (tools: unknown) => void
): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async (params?: unknown) => {
      const tools = (params as { tools?: unknown })?.tools || {};
      validator(tools);

      return {
        stream: simulateReadableStream({
          chunks: createTextStreamChunks('OK'),
        }),
        response: {
          id: 'response-1',
          timestamp: new Date(),
          modelId: 'mock-model',
          headers: {},
          messages: [{ role: 'assistant', content: 'OK' }],
        },
      };
    },
  });
}

// Re-export stream helpers for direct use
export { simulateReadableStream, createTextStreamChunks, createToolCallStreamChunks };
