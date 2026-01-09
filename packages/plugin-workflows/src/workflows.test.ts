import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { WorkflowsPlugin, type WorkflowsPluginConfig } from './WorkflowsPlugin';
import { DifyWorkflowRunner, type DifyWorkflowRunnerConfig } from './runners/DifyWorkflowRunner';
import type { WorkflowRunner, WorkflowInput, WorkflowResult, EventEmitter } from './types';
import type { ClientSession } from '@meetsmore-oss/use-ai-server';
import type { UseAIClientMessage, RunWorkflowMessage, AGUIEvent, ToolDefinition } from '@meetsmore-oss/use-ai-core';
import { EventType } from '@meetsmore-oss/use-ai-core';
import { v4 as uuidv4 } from 'uuid';

// Mock fetch for Dify tests
const mockFetch = mock((_url: string, _options?: any): Promise<Response> => {
  return Promise.resolve(new Response());
});

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = mockFetch as any;
  mockFetch.mockClear();
});

afterEach(() => {
  global.fetch = originalFetch;
});

// Helper to create a mock ClientSession
function createMockSession(sessionId: string = 'test-session'): ClientSession {
  return {
    socket: {
      emit: (..._args: any[]): boolean => true,
      id: sessionId,
    } as any,
    clientId: sessionId,
    threadId: 'test-thread',
    currentRunId: undefined,
    tools: [],
    state: null,
    pendingToolCalls: new Map(),
    conversationHistory: [],
    ipAddress: '127.0.0.1',
  };
}

// Helper to create event collector
function createEventCollector(): { emitter: EventEmitter; events: AGUIEvent[] } {
  const events: AGUIEvent[] = [];
  const emitter: EventEmitter = {
    emit: (event) => events.push(event),
  };
  return { emitter, events };
}

// Mock WorkflowRunner for testing
class MockWorkflowRunner implements WorkflowRunner {
  public executeCalls: WorkflowInput[] = [];
  private shouldFail: boolean = false;
  private responseText: string = 'Mock workflow result';
  private shouldEmitToolCalls: boolean = false;

  constructor(
    private name: string = 'mock-runner',
    options?: { shouldFail?: boolean; responseText?: string; shouldEmitToolCalls?: boolean }
  ) {
    this.shouldFail = options?.shouldFail || false;
    this.responseText = options?.responseText || 'Mock workflow result';
    this.shouldEmitToolCalls = options?.shouldEmitToolCalls || false;
  }

  getName(): string {
    return this.name;
  }

  async execute(input: WorkflowInput, events: EventEmitter): Promise<WorkflowResult> {
    this.executeCalls.push(input);

    // Emit RUN_STARTED
    events.emit({
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
      input: {
        threadId: input.threadId,
        runId: input.runId,
        messages: [],
        tools: input.tools,
        state: input.inputs,
      } as any,
      timestamp: Date.now(),
    });

    if (this.shouldFail) {
      events.emit({
        type: EventType.RUN_ERROR,
        message: 'Mock workflow error',
        timestamp: Date.now(),
      });
      return { success: false, error: 'Mock workflow error' };
    }

    // Emit tool call if requested
    if (this.shouldEmitToolCalls && input.tools.length > 0) {
      const toolCallId = uuidv4();
      const tool = input.tools[0];

      events.emit({
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName: tool.name,
        parentMessageId: uuidv4(),
        timestamp: Date.now(),
      });

      events.emit({
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: JSON.stringify({ test: 'value' }),
        timestamp: Date.now(),
      });

      events.emit({
        type: EventType.TOOL_CALL_END,
        toolCallId,
        timestamp: Date.now(),
      });

      // Wait for tool result (in real scenario, this would be provided by client)
      // For testing, we'll just simulate it was received
    }

    // Emit text message
    const messageId = uuidv4();
    events.emit({
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: 'assistant',
      timestamp: Date.now(),
    });

    events.emit({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: this.responseText,
      timestamp: Date.now(),
    });

    events.emit({
      type: EventType.TEXT_MESSAGE_END,
      messageId,
      timestamp: Date.now(),
    });

    // Emit RUN_FINISHED
    events.emit({
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
      result: this.responseText,
      timestamp: Date.now(),
    });

    return {
      success: true,
      output: { text: this.responseText },
    };
  }
}

describe('WorkflowsPlugin', () => {
  describe('Workflow Execution - Basic', () => {
    test('registers run_workflow message handler', () => {
      const mockRunner = new MockWorkflowRunner();
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);

      expect(handlers.has('run_workflow')).toBe(true);
    });

    test('workflows are stateless (no conversation history)', async () => {
      const mockRunner = new MockWorkflowRunner();
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const session = createMockSession();
      session.conversationHistory = [
        { role: 'user', content: 'Previous message' },
      ] as any;

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'mock',
          workflowId: 'test-workflow',
          inputs: { test: 'input' },
          tools: [],
          runId: uuidv4(),
          threadId: uuidv4(),
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      // Workflow should execute without using conversationHistory
      expect(mockRunner.executeCalls.length).toBe(1);
      expect(mockRunner.executeCalls[0].inputs).toEqual({ test: 'input' });
    });

    test('multiple workflow runners can be configured', () => {
      const runner1 = new MockWorkflowRunner('runner1');
      const runner2 = new MockWorkflowRunner('runner2');

      const plugin = new WorkflowsPlugin({
        runners: new Map([
          ['runner1', runner1],
          ['runner2', runner2],
        ]),
      });

      expect(plugin.getName()).toBe('workflows');
    });

    test('workflows execute via the WorkflowsPlugin on the server', async () => {
      const mockRunner = new MockWorkflowRunner();
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const session = createMockSession();
      const runId = uuidv4();
      const threadId = uuidv4();

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'mock',
          workflowId: 'test-workflow',
          inputs: { data: 'test' },
          tools: [],
          runId,
          threadId,
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      expect(mockRunner.executeCalls.length).toBe(1);
      expect(mockRunner.executeCalls[0].runId).toBe(runId);
      expect(mockRunner.executeCalls[0].workflowId).toBe('test-workflow');
    });

    test('only one workflow runner can be selected per execution', async () => {
      const runner1 = new MockWorkflowRunner('runner1');
      const runner2 = new MockWorkflowRunner('runner2');

      const plugin = new WorkflowsPlugin({
        runners: new Map([
          ['runner1', runner1],
          ['runner2', runner2],
        ]),
      });

      const session = createMockSession();
      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'runner1',
          workflowId: 'test-workflow',
          inputs: {},
          tools: [],
          runId: uuidv4(),
          threadId: uuidv4(),
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      // Only runner1 should be called
      expect(runner1.executeCalls.length).toBe(1);
      expect(runner2.executeCalls.length).toBe(0);
    });

    test('workflow execution status is tracked through AG-UI events', async () => {
      const mockRunner = new MockWorkflowRunner();
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const session = createMockSession();
      const emittedEvents: any[] = [];
      session.socket.emit = (eventName: string, event: any): boolean => {
        if (eventName === 'event') {
          emittedEvents.push(event);
        }
        return true;
      };

      const runId = uuidv4();
      const threadId = uuidv4();

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'mock',
          workflowId: 'test-workflow',
          inputs: {},
          tools: [],
          runId,
          threadId,
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      // Verify event sequence: RUN_STARTED -> TEXT_MESSAGE_* -> RUN_FINISHED
      const eventTypes = emittedEvents.map((e) => e.type);
      expect(eventTypes).toContain(EventType.RUN_STARTED);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_START);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_CONTENT);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_END);
      expect(eventTypes).toContain(EventType.RUN_FINISHED);
    });

    test('emits RUN_ERROR when runner not found', async () => {
      const plugin = new WorkflowsPlugin({
        runners: new Map([['valid-runner', new MockWorkflowRunner()]]),
      });

      const session = createMockSession();
      const emittedEvents: any[] = [];
      session.socket.emit = (eventName: string, event: any): boolean => {
        if (eventName === 'event') {
          emittedEvents.push(event);
        }
        return true;
      };

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'invalid-runner',
          workflowId: 'test-workflow',
          inputs: {},
          tools: [],
          runId: uuidv4(),
          threadId: uuidv4(),
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      const errorEvent = emittedEvents.find((e) => e.type === EventType.RUN_ERROR);
      expect(errorEvent).toBeDefined();
      expect(errorEvent.message).toContain('invalid-runner');
      expect(errorEvent.message).toContain('valid-runner');
    });
  });

  describe('Dify Integration', () => {
    test('Dify workflows can be integrated via DifyWorkflowRunner', () => {
      const config: DifyWorkflowRunnerConfig = {
        apiBaseUrl: 'http://localhost:3001/v1',
        workflows: {
          'test-workflow': 'app-test-key',
        },
      };

      const runner = new DifyWorkflowRunner(config);
      expect(runner.getName()).toBe('dify');
    });

    test('Dify API base URL is configurable', () => {
      const customUrl = 'https://custom.dify.ai/v1';
      const runner = new DifyWorkflowRunner({
        apiBaseUrl: customUrl,
        workflows: {},
      });

      expect(runner.getName()).toBe('dify');
    });

    test('workflow IDs map to Dify app API keys', async () => {
      mockFetch.mockImplementation(async (url: string, options: any) => {
        // Verify Authorization header contains mapped API key
        expect(options.headers['Authorization']).toBe('Bearer app-mapped-key');
        expect(url).toBe('http://localhost:3001/v1/workflows/run');

        // Return mock SSE stream
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"event":"workflow_finished"}\n\n'));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      });

      const runner = new DifyWorkflowRunner({
        apiBaseUrl: 'http://localhost:3001/v1',
        workflows: {
          'greeting-workflow': 'app-mapped-key',
        },
      });

      const session = createMockSession();
      const { emitter, events } = createEventCollector();

      await runner.execute(
        {
          session,
          runId: uuidv4(),
          threadId: uuidv4(),
          workflowId: 'greeting-workflow',
          inputs: { username: 'Alice' },
          tools: [],
        },
        emitter
      );

      expect(mockFetch).toHaveBeenCalled();
    });

    test('uses workflowId directly as API key when not in mapping', async () => {
      mockFetch.mockImplementation(async (url: string, options: any) => {
        expect(options.headers['Authorization']).toBe('Bearer app-direct-key');

        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"event":"workflow_finished"}\n\n'));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      });

      const runner = new DifyWorkflowRunner({
        apiBaseUrl: 'http://localhost:3001/v1',
        workflows: {},
      });

      const session = createMockSession();
      const { emitter, events } = createEventCollector();

      await runner.execute(
        {
          session,
          runId: uuidv4(),
          threadId: uuidv4(),
          workflowId: 'app-direct-key',
          inputs: {},
          tools: [],
        },
        emitter
      );

      expect(mockFetch).toHaveBeenCalled();
    });

    test('sends requests to Dify /workflows/run endpoint', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        expect(url).toBe('http://localhost:3001/v1/workflows/run');

        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"event":"workflow_finished"}\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      });

      const runner = new DifyWorkflowRunner({
        apiBaseUrl: 'http://localhost:3001/v1',
        workflows: { test: 'app-key' },
      });

      const session = createMockSession();
      const { emitter, events } = createEventCollector();

      await runner.execute(
        {
          session,
          runId: uuidv4(),
          threadId: uuidv4(),
          workflowId: 'test',
          inputs: {},
          tools: [],
        },
        emitter
      );

      expect(mockFetch).toHaveBeenCalled();
    });

    test('handles Dify Server-Sent Events (SSE) streaming responses', async () => {
      mockFetch.mockImplementation(async () => {
        const stream = new ReadableStream({
          start(controller) {
            // Simulate SSE stream with multiple events
            controller.enqueue(new TextEncoder().encode('data: {"event":"workflow_started","task_id":"123"}\n\n'));
            controller.enqueue(new TextEncoder().encode('data: {"event":"text_chunk","data":{"text":"Hello"}}\n\n'));
            controller.enqueue(new TextEncoder().encode('data: {"event":"text_chunk","data":{"text":" World"}}\n\n'));
            controller.enqueue(new TextEncoder().encode('data: {"event":"workflow_finished","data":{}}\n\n'));
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      });

      const runner = new DifyWorkflowRunner({
        apiBaseUrl: 'http://localhost:3001/v1',
        workflows: { test: 'app-key' },
      });

      const session = createMockSession();
      const { emitter, events } = createEventCollector();

      await runner.execute(
        {
          session,
          runId: uuidv4(),
          threadId: uuidv4(),
          workflowId: 'test',
          inputs: {},
          tools: [],
        },
        emitter
      );

      // Verify text chunks were processed
      const textContent = events.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
      expect(textContent.length).toBeGreaterThan(0);
    });

    test('text output from Dify workflows is streamed to client in real-time', async () => {
      mockFetch.mockImplementation(async () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"event":"text_chunk","data":{"text":"First"}}\n\n'));
            controller.enqueue(new TextEncoder().encode('data: {"event":"text_chunk","data":{"text":" Second"}}\n\n'));
            controller.enqueue(new TextEncoder().encode('data: {"event":"workflow_finished"}\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      });

      const runner = new DifyWorkflowRunner({
        apiBaseUrl: 'http://localhost:3001/v1',
        workflows: { test: 'app-key' },
      });

      const session = createMockSession();
      const { emitter, events } = createEventCollector();

      await runner.execute(
        {
          session,
          runId: uuidv4(),
          threadId: uuidv4(),
          workflowId: 'test',
          inputs: {},
          tools: [],
        },
        emitter
      );

      const textEvents = events.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
      expect(textEvents.length).toBe(2);
      expect((textEvents[0] as any).delta).toBe('First');
      expect((textEvents[1] as any).delta).toBe(' Second');
    });

    test('implements timeouts for Dify requests (100 seconds)', async () => {
      // Note: We can't easily test the actual 100-second timeout in unit tests
      // This test verifies the timeout mechanism exists by checking the abort signal
      let abortSignalUsed = false;

      mockFetch.mockImplementation(async (url: string, options: any) => {
        // Verify that an AbortSignal is provided
        expect(options.signal).toBeDefined();
        abortSignalUsed = true;

        // Return a valid response to avoid actual timeout
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"event":"workflow_finished"}\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      });

      const runner = new DifyWorkflowRunner({
        apiBaseUrl: 'http://localhost:3001/v1',
        workflows: { test: 'app-key' },
      });

      const session = createMockSession();
      const { emitter, events } = createEventCollector();

      await runner.execute(
        {
          session,
          runId: uuidv4(),
          threadId: uuidv4(),
          workflowId: 'test',
          inputs: {},
          tools: [],
        },
        emitter
      );

      expect(abortSignalUsed).toBe(true);
    });

    test('provides helpful error messages for Dify API failures', async () => {
      // Test 404
      mockFetch.mockImplementation(async () => new Response('Not found', { status: 404 }));

      const runner = new DifyWorkflowRunner({
        apiBaseUrl: 'http://localhost:3001/v1',
        workflows: { test: 'app-key' },
      });

      const session = createMockSession();
      const { emitter, events } = createEventCollector();

      let result = await runner.execute(
        {
          session,
          runId: uuidv4(),
          threadId: uuidv4(),
          workflowId: 'test',
          inputs: {},
          tools: [],
        },
        emitter
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');

      // Test 401
      mockFetch.mockImplementation(async () => new Response('Unauthorized', { status: 401 }));
      result = await runner.execute(
        {
          session,
          runId: uuidv4(),
          threadId: uuidv4(),
          workflowId: 'test',
          inputs: {},
          tools: [],
        },
        emitter
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('authentication failed');

      // Test 500
      mockFetch.mockImplementation(async () => new Response('Internal error', { status: 500 }));
      result = await runner.execute(
        {
          session,
          runId: uuidv4(),
          threadId: uuidv4(),
          workflowId: 'test',
          inputs: {},
          tools: [],
        },
        emitter
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('internal error');
    });
  });

  describe('Workflow Lifecycle & Callbacks', () => {
    test('workflow inputs can be provided as arbitrary JSON data', async () => {
      const mockRunner = new MockWorkflowRunner();
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const session = createMockSession();
      const complexInputs = {
        user: { name: 'Alice', id: 123 },
        settings: { theme: 'dark', notifications: true },
        data: [1, 2, 3, 4, 5],
      };

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'mock',
          workflowId: 'test-workflow',
          inputs: complexInputs,
          tools: [],
          runId: uuidv4(),
          threadId: uuidv4(),
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      expect(mockRunner.executeCalls[0].inputs).toEqual(complexInputs);
    });

    test('AG-UI events support progress tracking', async () => {
      const mockRunner = new MockWorkflowRunner('mock', { responseText: 'Final result' });
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const session = createMockSession();
      const emittedEvents: AGUIEvent[] = [];
      session.socket.emit = (eventName: string, event: any): boolean => {
        if (eventName === 'event') {
          emittedEvents.push(event);
        }
        return true;
      };

      const runId = uuidv4();
      const threadId = uuidv4();

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'mock',
          workflowId: 'test-workflow',
          inputs: {},
          tools: [],
          runId,
          threadId,
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      // Verify RUN_STARTED event for status updates
      const runStarted = emittedEvents.find((e) => e.type === EventType.RUN_STARTED);
      expect(runStarted).toBeDefined();

      // Verify TEXT_MESSAGE_CONTENT events for accumulated text
      const textContent = emittedEvents.find((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
      expect(textContent).toBeDefined();
      expect((textContent as any).delta).toBe('Final result');

      // Verify RUN_FINISHED event with final results
      const runFinished = emittedEvents.find((e) => e.type === EventType.RUN_FINISHED);
      expect(runFinished).toBeDefined();
      expect((runFinished as any).result).toBe('Final result');
    });

    test('onError callback support via RUN_ERROR event', async () => {
      const mockRunner = new MockWorkflowRunner('mock', { shouldFail: true });
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const session = createMockSession();
      const emittedEvents: AGUIEvent[] = [];
      session.socket.emit = (eventName: string, event: any): boolean => {
        if (eventName === 'event') {
          emittedEvents.push(event);
        }
        return true;
      };

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'mock',
          workflowId: 'test-workflow',
          inputs: {},
          tools: [],
          runId: uuidv4(),
          threadId: uuidv4(),
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      const errorEvent = emittedEvents.find((e) => e.type === EventType.RUN_ERROR);
      expect(errorEvent).toBeDefined();
      expect((errorEvent as any).message).toBe('Mock workflow error');
    });

    test('workflows emit AG-UI protocol events', async () => {
      const mockRunner = new MockWorkflowRunner();
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const session = createMockSession();
      const emittedEvents: AGUIEvent[] = [];
      session.socket.emit = (eventName: string, event: any): boolean => {
        if (eventName === 'event') {
          emittedEvents.push(event);
        }
        return true;
      };

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'mock',
          workflowId: 'test-workflow',
          inputs: {},
          tools: [],
          runId: uuidv4(),
          threadId: uuidv4(),
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      // Verify full AG-UI event sequence
      const eventTypes = emittedEvents.map((e) => e.type);
      expect(eventTypes).toContain(EventType.RUN_STARTED);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_START);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_CONTENT);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_END);
      expect(eventTypes).toContain(EventType.RUN_FINISHED);

      // Verify all events have timestamps
      emittedEvents.forEach((event) => {
        expect(event.timestamp).toBeDefined();
        expect(typeof event.timestamp).toBe('number');
      });
    });
  });

  describe('Workflow Tool Integration', () => {
    test('workflows can call back to client-side tools', async () => {
      const mockRunner = new MockWorkflowRunner('mock', { shouldEmitToolCalls: true });
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const session = createMockSession();
      const emittedEvents: AGUIEvent[] = [];
      session.socket.emit = (eventName: string, event: any): boolean => {
        if (eventName === 'event') {
          emittedEvents.push(event);
        }
        return true;
      };

      const tools: ToolDefinition[] = [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: {
              test: { type: 'string' },
            },
            required: ['test'],
          },
        },
      ];

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'mock',
          workflowId: 'test-workflow',
          inputs: {},
          tools,
          runId: uuidv4(),
          threadId: uuidv4(),
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      // Verify tool call events were emitted
      const toolCallStart = emittedEvents.find((e) => e.type === EventType.TOOL_CALL_START);
      expect(toolCallStart).toBeDefined();
      expect((toolCallStart as any).toolCallName).toBe('test_tool');
    });

    test('tools can be provided to workflows via trigger options', async () => {
      const mockRunner = new MockWorkflowRunner();
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const session = createMockSession();

      const tools: ToolDefinition[] = [
        {
          name: 'tool1',
          description: 'First tool',
          parameters: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'tool2',
          description: 'Second tool',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      ];

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'mock',
          workflowId: 'test-workflow',
          inputs: {},
          tools,
          runId: uuidv4(),
          threadId: uuidv4(),
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      expect(mockRunner.executeCalls[0].tools).toEqual(tools);
    });

    test('tool calls are tracked with names, arguments, and results', async () => {
      const mockRunner = new MockWorkflowRunner('mock', { shouldEmitToolCalls: true });
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const session = createMockSession();
      const emittedEvents: AGUIEvent[] = [];
      session.socket.emit = (eventName: string, event: any): boolean => {
        if (eventName === 'event') {
          emittedEvents.push(event);
        }
        return true;
      };

      const tools: ToolDefinition[] = [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: { test: { type: 'string' } },
            required: ['test'],
          },
        },
      ];

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'mock',
          workflowId: 'test-workflow',
          inputs: {},
          tools,
          runId: uuidv4(),
          threadId: uuidv4(),
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      // Verify tool call tracking
      const toolCallStart = emittedEvents.find((e) => e.type === EventType.TOOL_CALL_START);
      const toolCallArgs = emittedEvents.find((e) => e.type === EventType.TOOL_CALL_ARGS);
      const toolCallEnd = emittedEvents.find((e) => e.type === EventType.TOOL_CALL_END);

      expect(toolCallStart).toBeDefined();
      expect((toolCallStart as any).toolCallName).toBe('test_tool');

      expect(toolCallArgs).toBeDefined();
      const args = JSON.parse((toolCallArgs as any).delta);
      expect(args).toEqual({ test: 'value' });

      expect(toolCallEnd).toBeDefined();
      expect((toolCallEnd as any).toolCallId).toBe((toolCallStart as any).toolCallId);
    });

    test('onProgress receives updated tool call information', async () => {
      const mockRunner = new MockWorkflowRunner('mock', { shouldEmitToolCalls: true });
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const session = createMockSession();
      const emittedEvents: AGUIEvent[] = [];
      session.socket.emit = (eventName: string, event: any): boolean => {
        if (eventName === 'event') {
          emittedEvents.push(event);
        }
        return true;
      };

      const tools: ToolDefinition[] = [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: { test: { type: 'string' } },
            required: ['test'],
          },
        },
      ];

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'mock',
          workflowId: 'test-workflow',
          inputs: {},
          tools,
          runId: uuidv4(),
          threadId: uuidv4(),
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      // Client would receive these events and update tool call tracking in onProgress callback
      const toolCallEvents = emittedEvents.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_START ||
          e.type === EventType.TOOL_CALL_ARGS ||
          e.type === EventType.TOOL_CALL_END
      );
      expect(toolCallEvents.length).toBe(3);
    });

    test('tool execution errors are sent back to workflow', async () => {
      // This tests the protocol - actual error handling happens in the client
      // The workflow runner expects to receive tool results via session.pendingToolCalls
      const mockRunner = new MockWorkflowRunner('mock', { shouldEmitToolCalls: true });
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const session = createMockSession();
      const emittedEvents: AGUIEvent[] = [];
      session.socket.emit = (eventName: string, event: any): boolean => {
        if (eventName === 'event') {
          emittedEvents.push(event);
        }
        return true;
      };

      const tools: ToolDefinition[] = [
        {
          name: 'error_tool',
          description: 'A tool that will error',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ];

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'mock',
          workflowId: 'test-workflow',
          inputs: {},
          tools,
          runId: uuidv4(),
          threadId: uuidv4(),
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      // Verify tool call was emitted (client would respond with error)
      const toolCallEnd = emittedEvents.find((e) => e.type === EventType.TOOL_CALL_END);
      expect(toolCallEnd).toBeDefined();
    });

    test('updates session with workflow tools', async () => {
      const mockRunner = new MockWorkflowRunner();
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const session = createMockSession();
      const tools: ToolDefinition[] = [
        {
          name: 'test_tool',
          description: 'A test tool',
          parameters: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
        },
      ];

      const runId = uuidv4();
      const threadId = uuidv4();

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'mock',
          workflowId: 'test-workflow',
          inputs: { test: 'data' },
          tools,
          runId,
          threadId,
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      // Verify session was updated
      expect(session.threadId).toBe(threadId);
      expect(session.currentRunId).toBe(runId);
      expect(session.tools).toEqual(tools);
      expect(session.state).toEqual({ test: 'data' });
    });

    test('handles MCP headers from forwardedProps', async () => {
      const mockRunner = new MockWorkflowRunner();
      const plugin = new WorkflowsPlugin({
        runners: new Map([['mock', mockRunner]]),
      });

      const session = createMockSession();
      const mcpHeaders = {
        'https://api.example.com': {
          headers: { Authorization: 'Bearer test-token' },
        },
      };

      const message: RunWorkflowMessage = {
        type: 'run_workflow',
        data: {
          runner: 'mock',
          workflowId: 'test-workflow',
          inputs: {},
          tools: [],
          runId: uuidv4(),
          threadId: uuidv4(),
          forwardedProps: {
            mcpHeaders,
          },
        },
      };

      const handlers = new Map<string, any>();
      const mockServer = {
        registerMessageHandler: (type: string, handler: any) => {
          handlers.set(type, handler);
        },
      };

      plugin.registerHandlers(mockServer);
      const handler = handlers.get('run_workflow');
      await handler(session, message);

      // MCP headers should have been set during execution
      // They are cleared after completion, so we can't check them here
      // But we can verify the workflow executed successfully
      expect(mockRunner.executeCalls.length).toBe(1);
    });
  });
});
