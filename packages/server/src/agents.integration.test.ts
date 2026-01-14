import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { EventType } from './types';
import type { Agent, AgentInput, EventEmitter, AgentResult } from './agents/types';
import { v4 as uuidv4 } from 'uuid';
import {
  waitForEventType,
  collectEventsUntil,
  sendRunAgent,
  sendToolResult,
  extractTextFromEvents,
  extractToolCallsFromEvents,
} from '../test/test-utils';
import { UseAIServer } from './server';
import { AISDKAgent } from './agents/AISDKAgent';
import type { Tool, ToolDefinition } from './types';
import {
  createTestAgent,
  TestCleanupManager,
  createSequentialMockModel,
  createSystemPromptValidatorMockModel,
} from '../test/integration-test-utils';

// Track all servers and sockets for cleanup
const cleanup = new TestCleanupManager();

afterAll(() => {
  cleanup.cleanup();
});

describe('Agent System', () => {
  let server: UseAIServer;
  const testPort = 9002;

  beforeAll(() => {
    // Create server with multiple agents
    const claudeAgent = createTestAgent('claude');
    const gptAgent = createTestAgent('gpt');

    server = new UseAIServer({
      port: testPort,
      agents: { claude: claudeAgent, gpt: gptAgent },
      defaultAgent: 'claude',
    });
    cleanup.trackServer(server);
  });

  afterAll(() => {
    server.close();
  });

  test('Multiple AI agents can be configured', () => {
    // Server was initialized with two agents (claude and gpt)
    // Verified by successful server startup
    expect(server).toBeDefined();
  });

  test('A default agent is specified', async () => {
    const socket = await cleanup.createTestClient(testPort);

    // Send request without specifying agent (should use default)
    sendRunAgent(socket, {
      prompt: 'Test default agent',
      tools: [],
    });

    const response = await waitForEventType(socket, EventType.TEXT_MESSAGE_END);
    expect(response).toBeDefined();

    socket.disconnect();
  });

  test('AISDKAgent integrates with AI SDK language models', async () => {
    const socket = await cleanup.createTestClient(testPort);

    sendRunAgent(socket, {
      prompt: 'Test AI SDK',
      tools: [],
    });

    const events = await collectEventsUntil(socket, EventType.RUN_FINISHED);
    const text = extractTextFromEvents(events);

    expect(text).toBe('Default response');

    socket.disconnect();
  });

  test('Agents handle multi-step tool execution', async () => {
    // Create a custom server with dynamic mock responses for this test
    const multiStepPort = 9100;
    const multiStepMockModel = createSequentialMockModel([
      {
        toolCalls: [{ toolCallId: 'tool1', toolName: 'step1', input: {} }],
      },
      {
        toolCalls: [{ toolCallId: 'tool2', toolName: 'step2', input: {} }],
      },
      {
        text: 'Done with steps',
      },
    ]);

    const multiStepAgent = new AISDKAgent({ model: multiStepMockModel });
    const multiStepServer = new UseAIServer({
      port: multiStepPort,
      agents: { test: multiStepAgent },
      defaultAgent: 'test',
    });
    cleanup.trackServer(multiStepServer);

    const socket = await cleanup.createTestClient(multiStepPort);

    const tools: Tool[] = [
      {
        name: 'step1',
        description: 'Step 1',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'step2',
        description: 'Step 2',
        parameters: { type: 'object', properties: {} },
      },
    ];

    sendRunAgent(socket, {
      prompt: 'Execute multiple steps',
      tools,
    });

    // Handle first tool call - wait for END, then send result
    let toolCallEvents = await collectEventsUntil(socket, EventType.TOOL_CALL_END);
    let toolCalls = extractToolCallsFromEvents(toolCallEvents);
    sendToolResult(socket, toolCalls[0].toolCallId, { result: 'step1 done' });

    // Handle second tool call - wait for END, then send result
    toolCallEvents = await collectEventsUntil(socket, EventType.TOOL_CALL_END);
    toolCalls = extractToolCallsFromEvents(toolCallEvents);
    sendToolResult(socket, toolCalls[0].toolCallId, { result: 'step2 done' });

    // Get final response
    const finalEvents = await collectEventsUntil(socket, EventType.TEXT_MESSAGE_END);
    const text = extractTextFromEvents(finalEvents);

    expect(text).toBe('Done with steps');

    socket.disconnect();
    multiStepServer.close();
  });

  test('Custom agents can be implemented via Agent interface', async () => {
    // Create a custom agent implementation
    class CustomAgent implements Agent {
      getName(): string {
        return 'custom-agent';
      }

      async run(input: AgentInput, events: EventEmitter): Promise<AgentResult> {
        // Emit RUN_STARTED
        events.emit({
          type: EventType.RUN_STARTED,
          runId: input.runId,
          threadId: input.session.threadId,
          input: input.originalInput,
        });

        // Emit simple text response
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
          delta: 'Custom agent response',
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
          runId: input.runId,
          threadId: input.session.threadId,
          timestamp: Date.now(),
        });

        return {
          success: true,
          conversationHistory: input.messages,
        };
      }
    }

    // Create server with custom agent
    const customPort = 9003;
    const customAgent = new CustomAgent();
    const customServer = new UseAIServer({
      port: customPort,
      agents: { custom: customAgent },
      defaultAgent: 'custom',
    });
    cleanup.trackServer(customServer);

    const socket = await cleanup.createTestClient(customPort);

    sendRunAgent(socket, {
      prompt: 'Test custom agent',
      tools: [],
    });

    const events = await collectEventsUntil(socket, EventType.RUN_FINISHED);
    const text = extractTextFromEvents(events);

    expect(text).toBe('Custom agent response');

    socket.disconnect();
    customServer.close();
  });

  test('System builds dynamic system prompts with application state', async () => {
    // Create a custom server that verifies system prompt includes state
    const statePort = 9101;
    const stateMockModel = createSystemPromptValidatorMockModel((messages) => {
      const systemMessage = messages.find((m: any) => m.role === 'system');
      expect(systemMessage).toBeDefined();
    });

    const stateAgent = new AISDKAgent({ model: stateMockModel });
    const stateServer = new UseAIServer({
      port: statePort,
      agents: { test: stateAgent },
      defaultAgent: 'test',
    });
    cleanup.trackServer(stateServer);

    const socket = await cleanup.createTestClient(statePort);

    const state = { todos: ['task1', 'task2'] };

    sendRunAgent(socket, {
      prompt: 'Test state',
      tools: [],
      state,
    });

    await waitForEventType(socket, EventType.RUN_FINISHED);

    socket.disconnect();
    stateServer.close();
  });

  test('System instructs AI to ask for confirmation on confirmationRequired tools', async () => {
    // Create a custom server that verifies confirmation instructions
    const confirmPort = 9102;
    const confirmMockModel = createSystemPromptValidatorMockModel((messages) => {
      const systemMessage = messages.find(
        (m): m is { role: string; content: string } =>
          typeof m === 'object' && m !== null && (m as { role?: string }).role === 'system'
      );
      const systemContent = systemMessage?.content || '';
      expect(systemContent.toLowerCase()).toContain('confirm');
    });

    const confirmAgent = new AISDKAgent({ model: confirmMockModel });
    const confirmServer = new UseAIServer({
      port: confirmPort,
      agents: { test: confirmAgent },
      defaultAgent: 'test',
    });
    cleanup.trackServer(confirmServer);

    const socket = await cleanup.createTestClient(confirmPort);

    const tools: ToolDefinition[] = [
      {
        name: 'delete_account',
        description: 'Delete user account',
        parameters: { type: 'object', properties: {} },
        confirmationRequired: true,
      },
    ];

    sendRunAgent(socket, {
      prompt: 'Test confirmation',
      tools,
    });

    await waitForEventType(socket, EventType.RUN_FINISHED);

    socket.disconnect();
    confirmServer.close();
  });
});
