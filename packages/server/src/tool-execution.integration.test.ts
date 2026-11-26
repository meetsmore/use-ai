import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { EventType } from './types';
import {
  waitForEventType,
  collectEventsUntil,
  sendRunAgent,
  sendToolResult,
  extractTextFromEvents,
  extractToolCallsFromEvents,
} from '../test/test-utils';
import { UseAIServer } from './server';
import type { Tool } from './types';
import {
  createServerConfig,
  TestCleanupManager,
  createToolCallMockModel,
  createSequentialMockModel,
  createToolValidatorMockModel,
} from '../test/integration-test-utils';
import { AISDKAgent } from './agents/AISDKAgent';
import { defineServerTool } from './tools';
import { z } from 'zod';
import { getFreePort } from '../test/ports';

// Track all servers and sockets for cleanup
const cleanup = new TestCleanupManager();

afterAll(() => {
  cleanup.cleanup();
});

describe('Tool Execution Coordination', () => {
  let server: UseAIServer;
  let testPort: number;

  beforeAll(async () => {
    testPort = await getFreePort();
    server = new UseAIServer(createServerConfig(testPort));
    cleanup.trackServer(server);
  });

  afterAll(() => {
    server.close();
  });

  test('Tools execute on client side', async () => {
    // Create a custom server with tool call response
    const toolPort = await getFreePort();
    const toolMockModel = createSequentialMockModel([
      {
        toolCalls: [{ toolCallId: 'tool1', toolName: 'client_tool', input: { value: 'test' } }],
      },
      {
        text: 'Tool executed',
      },
    ]);

    const toolAgent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: toolMockModel }) } });
    const toolServer = new UseAIServer({
      port: toolPort,
      agents: { test: toolAgent },
      defaultAgent: 'test',
    });
    cleanup.trackServer(toolServer);

    const socket = await cleanup.createTestClient(toolPort);

    const tools: Tool[] = [
      {
        name: 'client_tool',
        description: 'Client-side tool',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: ['value'],
        },
      },
    ];

    const allEvents: any[] = [];
    const responsePromise = new Promise<void>((resolve) => {
      socket.on('event', (event: any) => {
        allEvents.push(event);
        if (event.type === EventType.TOOL_CALL_END) {
          sendToolResult(socket, event.toolCallId, { success: true });
        }
        if (event.type === EventType.TEXT_MESSAGE_END) {
          resolve();
        }
      });
    });

    sendRunAgent(socket, {
      prompt: 'Use client tool',
      tools,
    });

    // Wait for complete flow
    await responsePromise;

    // Server emits TOOL_CALL events to request client execution
    const toolCalls = extractToolCallsFromEvents(allEvents);

    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0].toolCallName).toBe('client_tool');

    socket.disconnect();
    toolServer.close();
  });

  test('Server coordinates tool calls between AI and client', async () => {
    // Create a custom server with dynamic mock responses
    const coordPort = await getFreePort();
    const coordMockModel = createSequentialMockModel([
      {
        toolCalls: [{ toolCallId: 'tool1', toolName: 'test_tool', input: { value: 'test' } }],
      },
      {
        text: 'Tool result received',
      },
    ]);

    const coordAgent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: coordMockModel }) } });
    const coordServer = new UseAIServer({
      port: coordPort,
      agents: { test: coordAgent },
      defaultAgent: 'test',
    });
    cleanup.trackServer(coordServer);

    const socket = await cleanup.createTestClient(coordPort);

    const tools: Tool[] = [
      {
        name: 'test_tool',
        description: 'Test',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: ['value'],
        },
      },
    ];

    const allEvents: any[] = [];
    const responsePromise = new Promise<void>((resolve) => {
      socket.on('event', (event: any) => {
        allEvents.push(event);
        if (event.type === EventType.TOOL_CALL_END) {
          sendToolResult(socket, event.toolCallId, { result: 'success' });
        }
        if (event.type === EventType.TEXT_MESSAGE_END) {
          resolve();
        }
      });
    });

    sendRunAgent(socket, {
      prompt: 'Test coordination',
      tools,
    });

    // Wait for complete flow
    await responsePromise;

    const toolCalls = extractToolCallsFromEvents(allEvents);
    const text = extractTextFromEvents(allEvents);

    expect(text).toBe('Tool result received');

    socket.disconnect();
    coordServer.close();
  });

  test('Server waits for tool results before continuing', async () => {
    // Create a custom server for waiting test
    const waitPort = await getFreePort();
    const waitMockModel = createSequentialMockModel([
      {
        toolCalls: [{ toolCallId: 'tool1', toolName: 'wait_tool', input: {} }],
      },
      {
        text: 'Continued after waiting',
      },
    ]);

    const waitAgent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: waitMockModel }) } });
    const waitServer = new UseAIServer({
      port: waitPort,
      agents: { test: waitAgent },
      defaultAgent: 'test',
    });
    cleanup.trackServer(waitServer);

    const socket = await cleanup.createTestClient(waitPort);

    const tools: Tool[] = [
      {
        name: 'wait_tool',
        description: 'Tool that requires waiting',
        parameters: { type: 'object', properties: {} },
      },
    ];

    const allEvents: any[] = [];
    const responsePromise = new Promise<void>((resolve) => {
      socket.on('event', (event: any) => {
        allEvents.push(event);
        if (event.type === EventType.TOOL_CALL_END) {
          // Simulate delay before sending result
          setTimeout(() => {
            sendToolResult(socket, event.toolCallId, { result: 'delayed result' });
          }, 100);
        }
        if (event.type === EventType.TEXT_MESSAGE_END) {
          resolve();
        }
      });
    });

    sendRunAgent(socket, {
      prompt: 'Test waiting',
      tools,
    });

    // Wait for complete flow
    await responsePromise;

    const text = extractTextFromEvents(allEvents);

    expect(text).toBe('Continued after waiting');

    socket.disconnect();
    waitServer.close();
  });

  test('Server handles multiple sequential tool calls', async () => {
    // Create a custom server for multiple tool calls
    const multiPort = await getFreePort();
    const multiMockModel = createSequentialMockModel([
      {
        toolCalls: [
          { toolCallId: 'tool1', toolName: 'tool_a', input: {} },
          { toolCallId: 'tool2', toolName: 'tool_b', input: {} },
        ],
      },
      {
        text: 'Both tools executed',
      },
    ]);

    const multiAgent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: multiMockModel }) } });
    const multiServer = new UseAIServer({
      port: multiPort,
      agents: { test: multiAgent },
      defaultAgent: 'test',
    });
    cleanup.trackServer(multiServer);

    const socket = await cleanup.createTestClient(multiPort);

    const tools: Tool[] = [
      {
        name: 'tool_a',
        description: 'Tool A',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'tool_b',
        description: 'Tool B',
        parameters: { type: 'object', properties: {} },
      },
    ];

    const allToolCalls: any[] = [];

    // Set up event listener BEFORE sending run_agent
    const collectToolCalls = new Promise<void>((resolve) => {
      socket.on('event', (event: any) => {
        if (event.type === EventType.TOOL_CALL_END) {
          allToolCalls.push(event);
          sendToolResult(socket, event.toolCallId, { result: 'ok' });
        }
        if (event.type === EventType.TEXT_MESSAGE_END) {
          resolve();
        }
      });
    });

    sendRunAgent(socket, {
      prompt: 'Use multiple tools',
      tools,
    });

    await collectToolCalls;

    expect(allToolCalls.length).toBe(2);

    socket.disconnect();
    multiServer.close();
  });

  test('Tool definitions are converted to AI SDK format', async () => {
    // Record the tools that the model gets. Check them after the run.
    // An expect() in the model callback would end the run with RUN_ERROR, not with a clear failure.
    const convPort = await getFreePort();
    let modelTools: unknown;
    const convMockModel = createToolValidatorMockModel((tools) => {
      modelTools = tools;
    });

    const convAgent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: convMockModel }) } });
    const convServer = new UseAIServer({
      port: convPort,
      agents: { test: convAgent },
      defaultAgent: 'test',
    });
    cleanup.trackServer(convServer);

    const socket = await cleanup.createTestClient(convPort);

    const tools: Tool[] = [
      {
        name: 'test_tool',
        description: 'Test tool',
        parameters: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
          required: ['value'],
        },
      },
    ];

    // Set up listener BEFORE sending message to avoid race condition
    const responsePromise = waitForEventType(socket, EventType.RUN_FINISHED);

    sendRunAgent(socket, {
      prompt: 'Test conversion',
      tools,
    });

    await responsePromise;

    expect(modelTools).toContainEqual({
      type: 'function',
      name: 'test_tool',
      description: 'Test tool',
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      },
    });

    socket.disconnect();
    convServer.close();
  });

  test('Server merges client-side tools with MCP-provided tools', async () => {
    // This is tested more thoroughly in MCP Integration section
    // Here we just verify the concept works
    const socket = await cleanup.createTestClient(testPort);

    const clientTools: Tool[] = [
      {
        name: 'client_tool',
        description: 'Client tool',
        parameters: { type: 'object', properties: {} },
      },
    ];

    sendRunAgent(socket, {
      prompt: 'Test merging',
      tools: clientTools,
    });

    await waitForEventType(socket, EventType.RUN_FINISHED);

    socket.disconnect();
  });
});

describe('Server tool argument validation', () => {
  test('a server tool runs only with arguments its Zod schema accepts', async () => {
    const port = await getFreePort();
    const received: unknown[] = [];
    const model = createSequentialMockModel([
      {
        toolCalls: [
          // An operator object where the schema expects a string
          { toolCallId: 'bad-call', toolName: 'find_user', input: { id: { $ne: null } } },
          // A valid id plus a key the schema does not declare
          { toolCallId: 'good-call', toolName: 'find_user', input: { id: 'user-1', extra: 'dropped' } },
        ],
      },
      { text: 'Done' },
    ]);
    const server = new UseAIServer({
      port,
      agents: { test: new AISDKAgent({ hooks: { loadConfig: () => ({ model }) } }) },
      defaultAgent: 'test',
      tools: {
        find_user: defineServerTool(
          'Find a user by id',
          z.object({ id: z.string() }),
          (args) => {
            received.push(args);
            return { found: true };
          }
        ),
      },
    });
    cleanup.trackServer(server);

    const socket = await cleanup.createTestClient(port);
    sendRunAgent(socket, { prompt: 'Find the user', tools: [] });
    const events = await collectEventsUntil(socket, EventType.RUN_FINISHED);

    // The tool ran once, for the valid call, without the undeclared key
    expect(received).toEqual([{ id: 'user-1' }]);

    const results = events.filter((e) => e.type === EventType.TOOL_CALL_RESULT) as Array<{ toolCallId: string; content: string }>;
    const badResult = JSON.parse(results.find((r) => r.toolCallId === 'bad-call')!.content);
    expect(badResult.error).toBe(true);
    expect(badResult.message).toContain('Invalid arguments for tool find_user');
    expect(badResult.message).toContain('args/id');
    expect(JSON.parse(results.find((r) => r.toolCallId === 'good-call')!.content)).toEqual({ found: true });

    socket.disconnect();
    server.close();
  });
});
