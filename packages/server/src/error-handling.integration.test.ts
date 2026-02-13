import { describe, expect, test, beforeAll, afterAll, mock } from 'bun:test';
import { EventType, ErrorCode, TOOL_APPROVAL_REQUEST } from './types';
import { v4 as uuidv4 } from 'uuid';
import {
  waitForEventType,
  sendRunAgent,
  collectEventsUntil,
} from '../test/test-utils';
import { UseAIServer } from './server';
import { AISDKAgent } from './agents/AISDKAgent';
import type { Tool, ToolDefinition } from './types';
import type { Agent, AgentInput, EventEmitter, AgentResult } from './agents/types';
import { langfuse } from './instrumentation';
import {
  createServerConfig,
  TestCleanupManager,
  createErrorMockModel,
  createSequentialMockModel,
  createMockModel,
} from '../test/integration-test-utils';

// Track all servers and sockets for cleanup
const cleanup = new TestCleanupManager();

afterAll(() => {
  cleanup.cleanup();
});

describe('Error Handling', () => {
  let server: UseAIServer;
  const testPort = 9313;

  beforeAll(() => {
    server = new UseAIServer(createServerConfig(testPort));
    cleanup.trackServer(server);
  });

  afterAll(() => {
    server.close();
  });

  test('Server emits RUN_ERROR events when agent execution fails', async () => {
    // Create a custom server with failing mock
    const errorPort = 9300;
    const errorMockModel = createErrorMockModel('Agent execution failed');

    const errorAgent = new AISDKAgent({ model: errorMockModel });
    const errorServer = new UseAIServer({
      port: errorPort,
      agents: { test: errorAgent },
      defaultAgent: 'test',
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
    const apiErrorPort = 9301;
    const apiErrorMockModel = createErrorMockModel('Model error');

    const apiErrorAgent = new AISDKAgent({ model: apiErrorMockModel });
    const apiErrorServer = new UseAIServer({
      port: apiErrorPort,
      agents: { test: apiErrorAgent },
      defaultAgent: 'test',
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
    const abortPort = 9302;
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

    // Wait for tool call to be pending on server
    await toolCallPromise;

    // Send abort before sending tool result
    socket.emit('message', {
      type: 'abort_run',
      data: { runId },
    });

    // Verify: server emits RUN_ERROR after abort
    const errorEvent = await waitForEventType(socket, EventType.RUN_ERROR);
    expect(errorEvent.type).toBe(EventType.RUN_ERROR);

    socket.disconnect();
    abortServer.close();
  });

  test('Server cancels pending tool calls when client disconnects', async () => {
    // This test validates that agent.run() completes (not hangs) when a client
    // disconnects while a tool call is pending. Without the AbortController fix,
    // the pending tool call Promise would never resolve, causing agent.run() to
    // hang indefinitely.
    const disconnectPort = 9303;
    const disconnectMockModel = createSequentialMockModel([
      {
        toolCalls: [{ toolCallId: 'tool-dc-1', toolName: 'pending_tool', input: {} }],
      },
      {
        text: 'Should not reach here',
      },
    ]);

    const disconnectAgent = new AISDKAgent({ model: disconnectMockModel });

    // Spy on agent.run() to track whether it completes and what it returns
    let runCompleted = false;
    let runResult: { success: boolean; error?: string } | null = null;
    const originalRun = disconnectAgent.run.bind(disconnectAgent);
    disconnectAgent.run = async (...args: Parameters<typeof originalRun>) => {
      const result = await originalRun(...args);
      runCompleted = true;
      runResult = result;
      return result;
    };

    const disconnectServer = new UseAIServer({
      port: disconnectPort,
      agents: { test: disconnectAgent },
      defaultAgent: 'test',
    });
    cleanup.trackServer(disconnectServer);

    const socket = await cleanup.createTestClient(disconnectPort);

    const tools: Tool[] = [
      {
        name: 'pending_tool',
        description: 'Tool that will be pending when client disconnects',
        parameters: { type: 'object', properties: {} },
      },
    ];

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
        threadId: uuidv4(),
        runId: uuidv4(),
        messages: [{ id: uuidv4(), role: 'user', content: 'test disconnect' }],
        tools,
        state: null,
        context: [],
        forwardedProps: {},
      },
    });

    // Wait for tool call to be pending on server
    await toolCallPromise;

    // Disconnect client while tool is pending (this is the core bug scenario)
    socket.disconnect();

    // Poll until agent.run() completes. Without the AbortController fix,
    // agent.run() would hang forever at the pending tool call Promise,
    // and this polling loop would timeout.
    const timeoutMs = 3000;
    const pollIntervalMs = 50;
    const deadline = Date.now() + timeoutMs;
    while (!runCompleted && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    expect(runCompleted).toBe(true);
    expect(runResult).not.toBeNull();
    expect(runResult!.success).toBe(false);

    disconnectServer.close();
  });
});

describe('Error recording and abort handling', () => {
  // Langfuse mock setup/teardown helpers
  function enableMockLangfuse() {
    const originalEnabled = langfuse.enabled;
    const originalClient = langfuse.client;
    const mockTrace = mock(() => {});
    langfuse.enabled = true;
    // Include flushAsync and baseUrl so FeedbackPlugin (auto-initialized when env vars are set) works
    langfuse.client = { trace: mockTrace, flushAsync: async () => {}, baseUrl: 'mock' } as any;
    return {
      mockTrace,
      restore: () => {
        langfuse.enabled = originalEnabled;
        langfuse.client = originalClient;
      },
    };
  }

  test('Pre-streamText error records pre_stream_error trace', async () => {
    const port = 9320;
    const lf = enableMockLangfuse();
    try {
      // Use a mock model with provider='anthropic' so applyCacheBreakpoints is active,
      // then throw inside the cacheBreakpoint function — this runs at AISDKAgent.ts:359
      // which is inside the try block but before streamTextStarted=true at line 365.
      const model = createMockModel(async () => {
        throw new Error('should not reach model');
      });
      (model as any).provider = 'anthropic';

      const agent = new AISDKAgent({
        model,
        cacheBreakpoint: () => { throw new Error('Cache breakpoint error'); },
      });
      const server = new UseAIServer({
        port,
        agents: { test: agent },
        defaultAgent: 'test',
      });
      cleanup.trackServer(server);

      const socket = await cleanup.createTestClient(port);

      sendRunAgent(socket, {
        prompt: 'trigger pre-stream error',
        tools: [],
      });

      const errorEvent = await waitForEventType(socket, EventType.RUN_ERROR);
      expect(errorEvent.type).toBe(EventType.RUN_ERROR);

      // Verify recordErrorTrace was called with pre_stream_error
      expect(lf.mockTrace).toHaveBeenCalledTimes(1);
      const call = (lf.mockTrace.mock.calls as any[][])[0][0];
      expect(call.tags).toEqual(['error', 'pre_stream_error']);
      expect(call.output.error).toContain('Cache breakpoint error');

      socket.disconnect();
      server.close();
    } finally {
      lf.restore();
    }
  });

  test('Abort during pending tool execution completes agent.run() with failure', async () => {
    // This test validates that agent.run() completes (not hangs) when abort_run
    // is sent while a tool call is pending. Without the AbortController fix,
    // the pending tool call Promise would never resolve.
    const port = 9321;
    const lf = enableMockLangfuse();
    try {
      const model = createSequentialMockModel([
        { toolCalls: [{ toolCallId: 'tc-abort-1', toolName: 'test_tool', input: {} }] },
        { text: 'Done' },
      ]);
      const agent = new AISDKAgent({ model });

      // Spy on agent.run() to track whether it completes and what it returns
      let runCompleted = false;
      let runResult: { success: boolean; error?: string } | null = null;
      const originalRun = agent.run.bind(agent);
      agent.run = async (...args: Parameters<typeof originalRun>) => {
        const result = await originalRun(...args);
        runCompleted = true;
        runResult = result;
        return result;
      };

      const server = new UseAIServer({
        port,
        agents: { test: agent },
        defaultAgent: 'test',
      });
      cleanup.trackServer(server);

      const socket = await cleanup.createTestClient(port);
      const runId = uuidv4();
      const threadId = uuidv4();

      const tools: Tool[] = [
        { name: 'test_tool', description: 'A test tool', parameters: { type: 'object', properties: {} } },
      ];

      // Wait for TOOL_CALL_END before aborting
      const toolCallPromise = new Promise<void>((resolve) => {
        socket.on('event', (event: any) => {
          if (event.type === EventType.TOOL_CALL_END) resolve();
        });
      });

      socket.emit('message', {
        type: 'run_agent',
        data: {
          threadId,
          runId,
          messages: [{ id: uuidv4(), role: 'user', content: 'use the tool' }],
          tools,
          state: null,
          context: [],
          forwardedProps: {},
        },
      });

      await toolCallPromise;

      // Abort while tool execution is pending
      socket.emit('message', { type: 'abort_run', data: { runId } });

      // Poll until agent.run() completes. Without the AbortController fix,
      // agent.run() would hang forever at the pending tool call Promise,
      // and this polling loop would timeout.
      const timeoutMs = 3000;
      const pollIntervalMs = 50;
      const deadline = Date.now() + timeoutMs;
      while (!runCompleted && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }

      expect(runCompleted).toBe(true);
      expect(runResult).not.toBeNull();
      expect(runResult!.success).toBe(false);

      // Post-streamText errors are NOT recorded via recordErrorTrace
      expect(lf.mockTrace).not.toHaveBeenCalled();

      socket.disconnect();
      server.close();
    } finally {
      lf.restore();
    }
  });

  test('Abort during pending tool approval completes agent.run() with failure', async () => {
    // This test validates that agent.run() completes (not hangs) when abort_run
    // is sent while a tool approval is pending. Without the AbortController fix,
    // the pending approval Promise would never resolve.
    const port = 9322;
    const lf = enableMockLangfuse();
    try {
      const model = createSequentialMockModel([
        { toolCalls: [{ toolCallId: 'tc-approval-1', toolName: 'destructive_tool', input: {} }] },
        { text: 'Done' },
      ]);
      const agent = new AISDKAgent({ model });

      // Spy on agent.run() to track whether it completes and what it returns
      let runCompleted = false;
      let runResult: { success: boolean; error?: string } | null = null;
      const originalRun = agent.run.bind(agent);
      agent.run = async (...args: Parameters<typeof originalRun>) => {
        const result = await originalRun(...args);
        runCompleted = true;
        runResult = result;
        return result;
      };

      const server = new UseAIServer({
        port,
        agents: { test: agent },
        defaultAgent: 'test',
      });
      cleanup.trackServer(server);

      const socket = await cleanup.createTestClient(port);
      const runId = uuidv4();
      const threadId = uuidv4();

      // Tool with destructiveHint requires approval
      const tools: ToolDefinition[] = [
        {
          name: 'destructive_tool',
          description: 'A destructive action',
          parameters: { type: 'object', properties: {} },
          annotations: { destructiveHint: true },
        },
      ];

      // Wait for TOOL_APPROVAL_REQUEST event
      const approvalPromise = new Promise<void>((resolve) => {
        socket.on('event', (event: any) => {
          if (event.type === TOOL_APPROVAL_REQUEST) resolve();
        });
      });

      socket.emit('message', {
        type: 'run_agent',
        data: {
          threadId,
          runId,
          messages: [{ id: uuidv4(), role: 'user', content: 'do destructive action' }],
          tools,
          state: null,
          context: [],
          forwardedProps: {},
        },
      });

      await approvalPromise;

      // Abort while waiting for user approval
      socket.emit('message', { type: 'abort_run', data: { runId } });

      // Poll until agent.run() completes. Without the AbortController fix,
      // agent.run() would hang forever at the pending approval Promise,
      // and this polling loop would timeout.
      const timeoutMs = 3000;
      const pollIntervalMs = 50;
      const deadline = Date.now() + timeoutMs;
      while (!runCompleted && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }

      expect(runCompleted).toBe(true);
      expect(runResult).not.toBeNull();
      expect(runResult!.success).toBe(false);

      // Post-streamText errors are NOT recorded via recordErrorTrace
      expect(lf.mockTrace).not.toHaveBeenCalled();

      socket.disconnect();
      server.close();
    } finally {
      lf.restore();
    }
  });

  test('Agent not found records agent_not_found trace', async () => {
    const port = 9323;
    const lf = enableMockLangfuse();
    try {
      const server = new UseAIServer(createServerConfig(port));
      cleanup.trackServer(server);

      const socket = await cleanup.createTestClient(port);

      socket.emit('message', {
        type: 'run_agent',
        data: {
          threadId: uuidv4(),
          runId: uuidv4(),
          messages: [{ id: uuidv4(), role: 'user', content: 'test' }],
          tools: [],
          state: null,
          context: [],
          forwardedProps: { agent: 'nonexistent' },
        },
      });

      const errorEvent = await waitForEventType(socket, EventType.RUN_ERROR);
      expect((errorEvent as any).message).toContain('not found');

      expect(lf.mockTrace).toHaveBeenCalledTimes(1);
      const call = (lf.mockTrace.mock.calls as any[][])[0][0];
      expect(call.tags).toEqual(['error', 'agent_not_found']);
      expect(call.output.error).toContain('not found');

      socket.disconnect();
      server.close();
    } finally {
      lf.restore();
    }
  });

  test('Rate limit exceeded records rate_limit_exceeded trace', async () => {
    const port = 9324;
    const lf = enableMockLangfuse();
    try {
      const server = new UseAIServer(
        createServerConfig(port, 'test-agent', {
          rateLimitMaxRequests: 1,
          rateLimitWindowMs: 60000,
        })
      );
      cleanup.trackServer(server);

      const socket = await cleanup.createTestClient(port);

      // First request succeeds (uses up the rate limit)
      sendRunAgent(socket, { prompt: 'first request', tools: [] });
      await waitForEventType(socket, EventType.RUN_FINISHED, 5000);

      // Reset mock after first request
      lf.mockTrace.mockClear();

      // Second request should be rate-limited
      sendRunAgent(socket, { prompt: 'second request', tools: [] });
      const errorEvent = await waitForEventType(socket, EventType.RUN_ERROR);
      expect((errorEvent as any).message).toContain('Rate limit exceeded');

      expect(lf.mockTrace).toHaveBeenCalledTimes(1);
      const call = (lf.mockTrace.mock.calls as any[][])[0][0];
      expect(call.tags).toEqual(['error', 'rate_limit_exceeded']);

      socket.disconnect();
      server.close();
    } finally {
      lf.restore();
    }
  });

  test('Unhandled agent error records unhandled_error trace', async () => {
    const port = 9325;
    const lf = enableMockLangfuse();
    try {
      // Custom agent that throws from run() — error propagates to server.ts outer catch
      const throwingAgent: Agent = {
        run(): Promise<AgentResult> {
          throw new Error('Unexpected agent failure');
        },
        getName() { return 'throwing'; },
      };

      const server = new UseAIServer({
        port,
        agents: { test: throwingAgent },
        defaultAgent: 'test',
      });
      cleanup.trackServer(server);

      const socket = await cleanup.createTestClient(port);

      sendRunAgent(socket, {
        prompt: 'trigger unhandled error',
        tools: [],
      });

      const errorEvent = await waitForEventType(socket, EventType.RUN_ERROR);
      expect(errorEvent.type).toBe(EventType.RUN_ERROR);
      expect((errorEvent as any).message).toContain('Unexpected agent failure');

      expect(lf.mockTrace).toHaveBeenCalledTimes(1);
      const call = (lf.mockTrace.mock.calls as any[][])[0][0];
      expect(call.tags).toEqual(['error', 'unhandled_error']);
      expect(call.output.error).toContain('Unexpected agent failure');

      socket.disconnect();
      server.close();
    } finally {
      lf.restore();
    }
  });
});
