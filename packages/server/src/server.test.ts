import { describe, expect, test, afterAll, mock } from 'bun:test';
import { EventType, ErrorCode } from './types';
import type { Tool, ToolDefinition } from './types';
import type { RemoteToolDefinition } from './mcp';
import {
  waitForEventType,
  collectEventsUntil,
  sendRunAgent,
  sendToolResult,
  extractTextFromEvents,
  extractToolCallsFromEvents,
} from '../test/test-utils';
import {
  createSequentialMockModel,
  createErrorMockModel,
  TestCleanupManager,
} from '../test/integration-test-utils';
import { UseAIServer } from './server';
import { AISDKAgent } from './agents/AISDKAgent';

// Global cleanup manager
const cleanup = new TestCleanupManager();

afterAll(() => {
  cleanup.cleanup();
});

// Test both runtime adapters
const RUNTIMES: ('bun' | 'node')[] = ['bun', 'node'];

// Port offset for each runtime to avoid conflicts
// bun: +2000, node: +1000 (ranges don't overlap)
const getPort = (basePort: number, runtime: 'bun' | 'node') =>
  basePort + (runtime === 'node' ? 1000 : 2000);

describe.each(RUNTIMES)('Connection Management [%s runtime]', (runtime) => {
  const testPort = getPort(8081, runtime);

  test('client can connect to the server', async () => {
    const mockModel = createSequentialMockModel([{ text: 'Hello' }]);
    const agent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: mockModel }) } });
    const server = new UseAIServer({
      port: testPort,
      agents: { test: agent },
      defaultAgent: 'test',
      runtime,
    });
    cleanup.trackServer(server);

    const socket = await cleanup.createTestClient(testPort);
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });

  test('server supports multiple clients', async () => {
    const mockModel = createSequentialMockModel([{ text: 'Hello' }]);
    const agent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: mockModel }) } });
    const server = new UseAIServer({
      port: testPort + 1,
      agents: { test: agent },
      defaultAgent: 'test',
      runtime,
    });
    cleanup.trackServer(server);

    const ws1 = await cleanup.createTestClient(testPort + 1);
    const ws2 = await cleanup.createTestClient(testPort + 1);

    expect(ws1.connected).toBe(true);
    expect(ws2.connected).toBe(true);

    ws1.disconnect();
    ws2.disconnect();
  });
});

describe.each(RUNTIMES)('Tool Use [%s runtime]', (runtime) => {
  test('tools can be registered and invoked by the AI', async () => {
    const toolPort = getPort(8182, runtime);
    const toolMockModel = createSequentialMockModel([
      {
        toolCalls: [{ toolCallId: 'toolu_123', toolName: 'add_todo', input: { text: 'Buy milk' } }],
      },
      {
        text: 'Todo added',
      },
    ]);

    const toolAgent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: toolMockModel }) } });
    const toolServer = new UseAIServer({
      port: toolPort,
      agents: { test: toolAgent },
      defaultAgent: 'test',
      runtime,
    });
    cleanup.trackServer(toolServer);

    const ws = await cleanup.createTestClient(toolPort);

    const tools: Tool[] = [
      {
        name: 'add_todo',
        description: 'Add a new todo',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
          },
          required: ['text'],
        },
      },
    ];

    const allEvents: any[] = [];
    const responsePromise = new Promise<void>((resolve) => {
      ws.on('event', (event: any) => {
        allEvents.push(event);
        if (event.type === EventType.TOOL_CALL_END) {
          sendToolResult(ws, event.toolCallId, { success: true });
        }
        if (event.type === EventType.TEXT_MESSAGE_END) {
          resolve();
        }
      });
    });

    sendRunAgent(ws, {
      prompt: 'Add a todo to buy milk',
      tools,
    });

    await responsePromise;

    const toolCalls = extractToolCallsFromEvents(allEvents);
    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0].toolCallName).toBe('add_todo');
    expect(toolCalls[0].args).toEqual({ text: 'Buy milk' });

    ws.disconnect();
  });

  test('the AI can invoke a tool on the client and receive a response', async () => {
    const tool2Port = getPort(8183, runtime);
    const tool2MockModel = createSequentialMockModel([
      {
        toolCalls: [{ toolCallId: 'toolu_456', toolName: 'get_data', input: { id: '123' } }],
      },
      {
        text: 'Got the data',
      },
    ]);

    const tool2Agent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: tool2MockModel }) } });
    const tool2Server = new UseAIServer({
      port: tool2Port,
      agents: { test: tool2Agent },
      defaultAgent: 'test',
      runtime,
    });
    cleanup.trackServer(tool2Server);

    const ws = await cleanup.createTestClient(tool2Port);

    const tools: Tool[] = [
      {
        name: 'get_data',
        description: 'Get data by ID',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
    ];

    const allEvents: any[] = [];
    const responsePromise = new Promise<void>((resolve) => {
      ws.on('event', (event: any) => {
        allEvents.push(event);
        if (event.type === EventType.TOOL_CALL_END) {
          sendToolResult(ws, event.toolCallId, { data: 'test data' });
        }
        if (event.type === EventType.TEXT_MESSAGE_END) {
          resolve();
        }
      });
    });

    sendRunAgent(ws, {
      prompt: 'Get data for ID 123',
      tools,
    });

    await responsePromise;

    const toolCalls = extractToolCallsFromEvents(allEvents);
    expect(toolCalls.length).toBe(1);
    expect(toolCalls[0].toolCallName).toBe('get_data');

    const responseText = extractTextFromEvents(allEvents);
    expect(responseText).toBe('Got the data');

    ws.disconnect();
  });

  test('server emits proper AG-UI event sequence', async () => {
    const seqPort = getPort(8184, runtime);
    const seqMockModel = createSequentialMockModel([{ text: 'Hello world' }]);

    const seqAgent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: seqMockModel }) } });
    const seqServer = new UseAIServer({
      port: seqPort,
      agents: { test: seqAgent },
      defaultAgent: 'test',
      runtime,
    });
    cleanup.trackServer(seqServer);

    const ws = await cleanup.createTestClient(seqPort);

    sendRunAgent(ws, {
      prompt: 'Say hello',
      tools: [],
    });

    const events = await collectEventsUntil(ws, EventType.RUN_FINISHED);

    // Verify event sequence
    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(events[1].type).toBe(EventType.MESSAGES_SNAPSHOT);
    expect(events[2].type).toBe(EventType.STATE_SNAPSHOT);

    // Find text message events
    const textStart = events.find(e => e.type === EventType.TEXT_MESSAGE_START);
    const textContent = events.find(e => e.type === EventType.TEXT_MESSAGE_CONTENT);
    const textEnd = events.find(e => e.type === EventType.TEXT_MESSAGE_END);

    expect(textStart).toBeDefined();
    expect(textContent).toBeDefined();
    expect(textEnd).toBeDefined();

    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe(EventType.RUN_FINISHED);

    ws.disconnect();
  });
});

describe.each(RUNTIMES)('Multiple Tool Use [%s runtime]', (runtime) => {
  test('AI can invoke multiple tools in sequence', async () => {
    const multiPort = getPort(8185, runtime);
    const multiMockModel = createSequentialMockModel([
      {
        toolCalls: [
          { toolCallId: 'tool1', toolName: 'add_todo', input: { text: 'Task 1' } },
          { toolCallId: 'tool2', toolName: 'add_todo', input: { text: 'Task 2' } },
        ],
      },
      {
        text: 'Tasks added',
      },
    ]);

    const multiAgent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: multiMockModel }) } });
    const multiServer = new UseAIServer({
      port: multiPort,
      agents: { test: multiAgent },
      defaultAgent: 'test',
      runtime,
    });
    cleanup.trackServer(multiServer);

    const ws = await cleanup.createTestClient(multiPort);

    const tools: Tool[] = [
      {
        name: 'add_todo',
        description: 'Add a todo',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
          },
          required: ['text'],
        },
      },
    ];

    const allEvents: any[] = [];
    const receivedToolCalls: any[] = [];

    const collectEvents = new Promise<void>((resolve) => {
      ws.on('event', (event: any) => {
        allEvents.push(event);

        if (event.type === EventType.TOOL_CALL_END) {
          const toolCallId = event.toolCallId;
          const toolCallData = allEvents.filter(e =>
            e.type === EventType.TOOL_CALL_START && e.toolCallId === toolCallId
          )[0];
          const argsData = allEvents.filter(e =>
            e.type === EventType.TOOL_CALL_ARGS && e.toolCallId === toolCallId
          )[0];

          if (toolCallData && argsData) {
            receivedToolCalls.push({
              toolCallId,
              args: JSON.parse(argsData.delta),
            });

            sendToolResult(ws, toolCallId, { success: true });
          }
        }

        if (event.type === EventType.TEXT_MESSAGE_END) {
          resolve();
        }
      });
    });

    sendRunAgent(ws, {
      prompt: 'Add two tasks',
      tools,
    });

    await collectEvents;

    expect(receivedToolCalls.length).toBe(2);
    expect(receivedToolCalls[0].args).toEqual({ text: 'Task 1' });
    expect(receivedToolCalls[1].args).toEqual({ text: 'Task 2' });

    const finalText = extractTextFromEvents(allEvents);
    expect(finalText).toBe('Tasks added');

    ws.disconnect();
  });
});

describe.each(RUNTIMES)('Error Handling [%s runtime]', (runtime) => {
  test('server emits error event when AI call fails', async () => {
    const errorPort = getPort(8186, runtime);
    const errorMockModel = createErrorMockModel('API Error');

    const errorAgent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: errorMockModel }) } });
    const errorServer = new UseAIServer({
      port: errorPort,
      agents: { test: errorAgent },
      defaultAgent: 'test',
      runtime,
    });
    cleanup.trackServer(errorServer);

    const ws = await cleanup.createTestClient(errorPort);

    sendRunAgent(ws, {
      prompt: 'This will fail',
      tools: [],
    });

    const errorEvent = await waitForEventType(ws, EventType.RUN_ERROR);
    expect(errorEvent.type).toBe(EventType.RUN_ERROR);
    // Server now sends error codes instead of messages for i18n support
    expect((errorEvent as any).message).toBe(ErrorCode.UNKNOWN_ERROR);

    ws.disconnect();
  });
});

describe.each(RUNTIMES)('State Management [%s runtime]', (runtime) => {
  test('server includes state in STATE_SNAPSHOT event', async () => {
    const statePort = getPort(8187, runtime);
    const stateMockModel = createSequentialMockModel([{ text: 'OK' }]);

    const stateAgent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: stateMockModel }) } });
    const stateServer = new UseAIServer({
      port: statePort,
      agents: { test: stateAgent },
      defaultAgent: 'test',
      runtime,
    });
    cleanup.trackServer(stateServer);

    const ws = await cleanup.createTestClient(statePort);

    const testState = { todos: ['task 1', 'task 2'] };

    sendRunAgent(ws, {
      prompt: 'List todos',
      tools: [],
      state: testState,
    });

    const events = await collectEventsUntil(ws, EventType.RUN_FINISHED);

    const stateSnapshot = events.find(e => e.type === EventType.STATE_SNAPSHOT);
    expect(stateSnapshot).toBeDefined();
    expect((stateSnapshot as any).snapshot).toEqual(testState);

    ws.disconnect();
  });
});

describe.each(RUNTIMES)('Rate Limiting [%s runtime]', (runtime) => {
  test('server allows requests within rate limit', async () => {
    const ratePort = getPort(8188, runtime);
    const rateMockModel = createSequentialMockModel([
      { text: 'OK' },
      { text: 'OK' },
    ]);

    const rateAgent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: rateMockModel }) } });
    const rateServer = new UseAIServer({
      port: ratePort,
      agents: { test: rateAgent },
      defaultAgent: 'test',
      rateLimitMaxRequests: 2,
      rateLimitWindowMs: 1000,
      runtime,
    });
    cleanup.trackServer(rateServer);

    const ws = await cleanup.createTestClient(ratePort);

    // First request
    sendRunAgent(ws, {
      prompt: 'Request 1',
      tools: [],
    });

    const response1 = await waitForEventType(ws, EventType.TEXT_MESSAGE_END);
    expect(response1.type).toBe(EventType.TEXT_MESSAGE_END);

    // Second request
    sendRunAgent(ws, {
      prompt: 'Request 2',
      tools: [],
    });

    const response2 = await waitForEventType(ws, EventType.TEXT_MESSAGE_END);
    expect(response2.type).toBe(EventType.TEXT_MESSAGE_END);

    ws.disconnect();
  });

  test('server blocks requests exceeding rate limit', async () => {
    const blockPort = getPort(8189, runtime);
    const blockMockModel = createSequentialMockModel([
      { text: 'OK' },
      { text: 'OK' },
    ]);

    const blockAgent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: blockMockModel }) } });
    const blockServer = new UseAIServer({
      port: blockPort,
      agents: { test: blockAgent },
      defaultAgent: 'test',
      rateLimitMaxRequests: 2,
      rateLimitWindowMs: 1000,
      runtime,
    });
    cleanup.trackServer(blockServer);

    const ws = await cleanup.createTestClient(blockPort);

    // Use up the rate limit
    sendRunAgent(ws, { prompt: 'Request 1', tools: [] });
    await waitForEventType(ws, EventType.TEXT_MESSAGE_END);

    sendRunAgent(ws, { prompt: 'Request 2', tools: [] });
    await waitForEventType(ws, EventType.TEXT_MESSAGE_END);

    // Third request should be rate limited
    sendRunAgent(ws, { prompt: 'Request 3', tools: [] });

    const errorEvent = await waitForEventType(ws, EventType.RUN_ERROR);
    expect(errorEvent.type).toBe(EventType.RUN_ERROR);
    expect((errorEvent as any).message).toContain('Rate limit exceeded');

    ws.disconnect();
  });

  test('rate limit resets after time window expires', async () => {
    const resetPort = getPort(8190, runtime);
    const resetMockModel = createSequentialMockModel([
      { text: 'OK' },
      { text: 'OK' },
      { text: 'OK' },
    ]);

    const resetAgent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: resetMockModel }) } });
    const resetServer = new UseAIServer({
      port: resetPort,
      agents: { test: resetAgent },
      defaultAgent: 'test',
      rateLimitMaxRequests: 2,
      rateLimitWindowMs: 1000,
      runtime,
    });
    cleanup.trackServer(resetServer);

    const ws = await cleanup.createTestClient(resetPort);

    // Use up the rate limit
    sendRunAgent(ws, { prompt: 'Request 1', tools: [] });
    await waitForEventType(ws, EventType.TEXT_MESSAGE_END);

    sendRunAgent(ws, { prompt: 'Request 2', tools: [] });
    await waitForEventType(ws, EventType.TEXT_MESSAGE_END);

    // Verify rate limit is hit
    sendRunAgent(ws, { prompt: 'Request 3', tools: [] });
    const errorEvent = await waitForEventType(ws, EventType.RUN_ERROR);
    expect((errorEvent as any).message).toContain('Rate limit exceeded');

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Should be allowed again
    sendRunAgent(ws, { prompt: 'Request 4', tools: [] });
    const response = await waitForEventType(ws, EventType.TEXT_MESSAGE_END);
    expect(response.type).toBe(EventType.TEXT_MESSAGE_END);

    ws.disconnect();
  });

  test('clients from same IP share rate limit', async () => {
    const indepPort = getPort(8191, runtime);
    const indepMockModel = createSequentialMockModel([
      { text: 'OK' },
      { text: 'OK' },
    ]);

    const indepAgent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: indepMockModel }) } });
    const indepServer = new UseAIServer({
      port: indepPort,
      agents: { test: indepAgent },
      defaultAgent: 'test',
      rateLimitMaxRequests: 2,
      rateLimitWindowMs: 1000,
      runtime,
    });
    cleanup.trackServer(indepServer);

    const ws1 = await cleanup.createTestClient(indepPort);
    const ws2 = await cleanup.createTestClient(indepPort);

    // Client 1 makes one request
    sendRunAgent(ws1, { prompt: 'Client 1 Request 1', tools: [] });
    await waitForEventType(ws1, EventType.TEXT_MESSAGE_END);

    // Client 2 makes one request (shares IP with client 1)
    sendRunAgent(ws2, { prompt: 'Client 2 Request 1', tools: [] });
    await waitForEventType(ws2, EventType.TEXT_MESSAGE_END);

    // Third request from either client should be rate limited (both share the same IP rate limit)
    sendRunAgent(ws1, { prompt: 'Client 1 Request 2', tools: [] });
    const error1 = await waitForEventType(ws1, EventType.RUN_ERROR);
    expect((error1 as any).message).toContain('Rate limit exceeded');

    ws1.disconnect();
    ws2.disconnect();
  });
});

describe('handleToolResult - MCP tool preservation', () => {
  test('updating client tools mid-run should preserve MCP (remote) tools', () => {
    // Bug: handleToolResult replaced session.tools with only client tools from
    // forwardedProps, dropping MCP tools. Fix: merge client tools with existing MCP tools.

    const mockModel = createSequentialMockModel([{ text: 'OK' }]);
    const agent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: mockModel }) } });
    const server = new UseAIServer({
      port: 19001,
      agents: { test: agent },
      defaultAgent: 'test',
    });
    cleanup.trackServer(server);

    const mcpTool: RemoteToolDefinition = {
      name: 'mcp_search',
      description: 'MCP search tool',
      parameters: { type: 'object', properties: {}, required: [] },
      _remote: {
        provider: { executeTool: mock(() => Promise.resolve({ success: true })) } as unknown as RemoteToolDefinition['_remote']['provider'],
        originalName: 'search',
      },
    };

    const clientToolA: ToolDefinition = {
      name: 'navigate',
      description: 'Navigate',
      parameters: { type: 'object', properties: { page: { type: 'string' } }, required: ['page'] },
    };

    const clientToolB: ToolDefinition = {
      name: 'add_todo',
      description: 'Add todo',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    };

    // Create a mock session with both client and MCP tools
    const session = {
      clientId: 'test-client',
      tools: [clientToolA, mcpTool] as ToolDefinition[],
      pendingToolCalls: new Map<string, (content: string) => void>(),
    };

    // Add a pending resolver so handleToolResult can resolve it
    let resolvedContent: string | undefined;
    session.pendingToolCalls.set('tool-call-1', (content: string) => {
      resolvedContent = content;
    });

    // Simulate handleToolResult with client sending updated tools (without MCP tools)
    const message = {
      type: 'tool_result' as const,
      data: {
        messageId: 'msg-1',
        toolCallId: 'tool-call-1',
        content: JSON.stringify({ success: true }),
        role: 'tool' as const,
        forwardedProps: {
          tools: [clientToolA, clientToolB], // Client sends only client tools
        },
      },
    };

    // Call handleToolResult via the private method
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).handleToolResult(session, message);

    // Verify tool result was resolved
    expect(resolvedContent).toBe(JSON.stringify({ success: true }));

    // Verify MCP tools are preserved alongside updated client tools
    expect(session.tools.length).toBe(3);
    const toolNames = session.tools.map(t => t.name).sort();
    expect(toolNames).toEqual(['add_todo', 'mcp_search', 'navigate']);

    // Verify the MCP tool still has its _remote property
    const mcpToolInSession = session.tools.find(t => t.name === 'mcp_search');
    expect(mcpToolInSession).toBeDefined();
    expect((mcpToolInSession as RemoteToolDefinition)._remote).toBeDefined();
    expect((mcpToolInSession as RemoteToolDefinition)._remote.originalName).toBe('search');
  });

  test('handleToolResult without forwardedProps.tools should not modify session.tools', () => {
    const mockModel = createSequentialMockModel([{ text: 'OK' }]);
    const agent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: mockModel }) } });
    const server = new UseAIServer({
      port: 19002,
      agents: { test: agent },
      defaultAgent: 'test',
    });
    cleanup.trackServer(server);

    const mcpTool: RemoteToolDefinition = {
      name: 'mcp_search',
      description: 'MCP search tool',
      parameters: { type: 'object', properties: {}, required: [] },
      _remote: {
        provider: { executeTool: mock(() => Promise.resolve({ success: true })) } as unknown as RemoteToolDefinition['_remote']['provider'],
        originalName: 'search',
      },
    };

    const clientTool: ToolDefinition = {
      name: 'navigate',
      description: 'Navigate',
      parameters: { type: 'object', properties: { page: { type: 'string' } }, required: ['page'] },
    };

    const session = {
      clientId: 'test-client',
      tools: [clientTool, mcpTool] as ToolDefinition[],
      pendingToolCalls: new Map<string, (content: string) => void>(),
    };

    session.pendingToolCalls.set('tool-call-2', () => {});

    // No forwardedProps.tools
    const message = {
      type: 'tool_result' as const,
      data: {
        messageId: 'msg-2',
        toolCallId: 'tool-call-2',
        content: JSON.stringify({ success: true }),
        role: 'tool' as const,
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).handleToolResult(session, message);

    // Tools should be unchanged
    expect(session.tools.length).toBe(2);
    expect(session.tools.map(t => t.name).sort()).toEqual(['mcp_search', 'navigate']);
  });
});
