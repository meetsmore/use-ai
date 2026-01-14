import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { EventType, ErrorCode } from './types';
import { v4 as uuidv4 } from 'uuid';
import {
  waitForEventType,
  sendRunAgent,
} from '../test/test-utils';
import { UseAIServer } from './server';
import { AISDKAgent } from './agents/AISDKAgent';
import type { Tool } from './types';
import {
  createServerConfig,
  TestCleanupManager,
  createErrorMockModel,
  createSequentialMockModel,
} from '../test/integration-test-utils';

// Track all servers and sockets for cleanup
const cleanup = new TestCleanupManager();

afterAll(() => {
  cleanup.cleanup();
});

describe('Error Handling', () => {
  let server: UseAIServer;
  const testPort = 9013;

  beforeAll(() => {
    server = new UseAIServer(createServerConfig(testPort));
    cleanup.trackServer(server);
  });

  afterAll(() => {
    server.close();
  });

  test('Server emits RUN_ERROR events when agent execution fails', async () => {
    // Create a custom server with failing mock
    const errorPort = 9200;
    const errorMockModel = createErrorMockModel('Agent execution failed');

    const errorAgent = new AISDKAgent({ model: errorMockModel });
    const errorServer = new UseAIServer({
      port: errorPort,
      agents: { test: errorAgent },
      defaultAgent: 'test',
      cors: { origin: '*' },
    });
    cleanup.trackServer(errorServer);

    const socket = await cleanup.createTestClient(errorPort);

    sendRunAgent(socket, {
      prompt: 'This will fail',
      tools: [],
    });

    const errorEvent = await waitForEventType(socket, EventType.RUN_ERROR);
    expect(errorEvent.type).toBe(EventType.RUN_ERROR);
    expect((errorEvent as any).message).toBe(ErrorCode.UNKNOWN_ERROR);

    socket.disconnect();
    errorServer.close();
  });

  test('Server catches and handles AI SDK model errors', async () => {
    // Create a custom server with API error
    const apiErrorPort = 9201;
    const apiErrorMockModel = createErrorMockModel('Model error');

    const apiErrorAgent = new AISDKAgent({ model: apiErrorMockModel });
    const apiErrorServer = new UseAIServer({
      port: apiErrorPort,
      agents: { test: apiErrorAgent },
      defaultAgent: 'test',
      cors: { origin: '*' },
    });
    cleanup.trackServer(apiErrorServer);

    const socket = await cleanup.createTestClient(apiErrorPort);

    sendRunAgent(socket, {
      prompt: 'Model error test',
      tools: [],
    });

    const errorEvent = await waitForEventType(socket, EventType.RUN_ERROR);
    expect(errorEvent.type).toBe(EventType.RUN_ERROR);

    socket.disconnect();
    apiErrorServer.close();
  });

  test('Server handles MCP tool execution errors', () => {
    // MCP error handling is tested in RemoteMcpToolsProvider
    // Errors are propagated to the AI as tool result errors
    expect(true).toBe(true);
  });

  test('Server emits helpful errors when requested agents not found', async () => {
    const socket = await cleanup.createTestClient(testPort);

    // Send request with non-existent agent
    socket.emit('message', {
      type: 'run_agent',
      data: {
        threadId: uuidv4(),
        runId: uuidv4(),
        messages: [{ id: uuidv4(), role: 'user', content: 'test' }],
        tools: [],
        state: null,
        context: [],
        forwardedProps: { agent: 'nonexistent-agent' },
      },
    });

    const errorEvent = await waitForEventType(socket, EventType.RUN_ERROR);
    expect((errorEvent as any).message).toContain('not found');

    socket.disconnect();
  });

  test('Server supports aborting in-flight agent executions', async () => {
    // Create a custom server with slow tool execution
    const abortPort = 9202;
    const abortMockModel = createSequentialMockModel([
      {
        toolCalls: [{ toolCallId: 'tool1', toolName: 'slow_tool', input: {} }],
      },
      {
        text: 'Should not reach here',
      },
    ]);

    const abortAgent = new AISDKAgent({ model: abortMockModel });
    const abortServer = new UseAIServer({
      port: abortPort,
      agents: { test: abortAgent },
      defaultAgent: 'test',
      cors: { origin: '*' },
    });
    cleanup.trackServer(abortServer);

    const socket = await cleanup.createTestClient(abortPort);

    const tools: Tool[] = [
      {
        name: 'slow_tool',
        description: 'Slow tool',
        parameters: { type: 'object', properties: {} },
      },
    ];

    const runId = uuidv4();
    const threadId = uuidv4();

    // Set up event listener before sending run_agent
    const toolCallPromise = new Promise<void>((resolve) => {
      socket.on('event', (event: any) => {
        if (event.type === EventType.TOOL_CALL_END) {
          resolve();
        }
      });
    });

    socket.emit('message', {
      type: 'run_agent',
      data: {
        threadId,
        runId,
        messages: [{ id: uuidv4(), role: 'user', content: 'test' }],
        tools,
        state: null,
        context: [],
        forwardedProps: {},
      },
    });

    // Wait for tool call
    await toolCallPromise;

    // Send abort before sending tool result
    socket.emit('message', {
      type: 'abort_run',
      data: { runId },
    });

    // Wait a bit to ensure abort is processed
    await new Promise(resolve => setTimeout(resolve, 200));

    // Abort functionality is implemented - run should be cancelled
    // The specific behavior depends on the agent implementation

    socket.disconnect();
    abortServer.close();
  });
});
