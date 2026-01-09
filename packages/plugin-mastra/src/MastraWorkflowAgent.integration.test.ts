/**
 * Integration test for MastraWorkflowAgent.
 *
 * This test makes actual API requests to the Anthropic API.
 *
 * Run with:
 *   cd packages/plugin-mastra
 *   bun --env-file=../../.env test src/MastraWorkflowAgent.integration.test.ts
 */

import { describe, it, expect, beforeAll, mock } from 'bun:test';
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { createAnthropic } from '@ai-sdk/anthropic';
import { tool } from 'ai';
import { z } from 'zod';
import { MastraWorkflowAgent } from './MastraWorkflowAgent';
import { pipeFullStreamWithToolEvents } from './streamHelpers';
import { mastraWorkflowInputSchema, mastraWorkflowOutputSchema } from './types';
import { EventType } from '@meetsmore-oss/use-ai-core';
import type {
  AGUIEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  TextMessageContentEvent,
} from '@meetsmore-oss/use-ai-core';
import type { AgentInput, EventEmitter, ClientSession, ToolDefinition } from '@meetsmore-oss/use-ai-server';
import { v4 as uuidv4 } from 'uuid';

// Calculator tool execution logic (shared between server-side and client-side tests)
// Returns a fixed result - actual calculation is not needed for testing the tool call flow
function executeCalculator(_expression: string): { result: string } {
  return { result: '105' };
}

// Check API key before running tests
beforeAll(() => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY required. Run with: bun --env-file=../../.env test src/MastraWorkflowAgent.integration.test.ts'
    );
  }
});

// ============================================================================
// Test Utilities
// ============================================================================

function createMockEventEmitter(): EventEmitter & { events: AGUIEvent[] } {
  const events: AGUIEvent[] = [];
  return {
    events,
    emit: (event) => {
      events.push(event as AGUIEvent);
    },
  };
}

function createMockSession(): ClientSession {
  return {
    clientId: 'test-client',
    ipAddress: '127.0.0.1',
    socket: {
      id: 'test-socket',
      connected: true,
      emit: () => {},
      on: () => {},
      off: () => {},
      disconnect: () => {},
    } as unknown as ClientSession['socket'],
    threadId: 'test-thread',
    tools: [],
    state: null,
    conversationHistory: [],
    pendingToolCalls: new Map(),
  };
}

function createAgentInput(session: ClientSession, messages: unknown[]): AgentInput {
  return {
    session,
    runId: uuidv4(),
    messages: messages as never[],
    tools: [],
    state: null,
    systemPrompt: 'You are a helpful assistant. Keep responses brief.',
    originalInput: {
      threadId: session.threadId,
      runId: uuidv4(),
      messages: messages.map((m) => ({ id: uuidv4(), ...(m as object) })) as never[],
      tools: [],
      state: null,
      context: [],
    },
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('MastraWorkflowAgent', () => {
  describe('Streaming workflow with tools', () => {
    it('should stream responses and emit correct AG-UI events with server-side tools', async () => {
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!,
      });

      // Create a calculator tool
      const calculatorSchema = z.object({
        expression: z.string().describe('The expression to evaluate'),
      });
      const calculatorTool = tool({
        description: 'Calculate a mathematical expression',
        inputSchema: calculatorSchema,
        execute: async ({ expression }) => executeCalculator(expression),
      });

      // Create agent with tool
      const testAgent = new Agent({
        id: 'calculator-agent',
        name: 'calculatorAgent',
        model: anthropic('claude-haiku-4-5'),
        instructions: 'You are a helpful assistant. Use the calculator tool for math.',
        tools: { calculator: calculatorTool },
      });

      // Create workflow step using pipeFullStreamWithToolEvents helper
      const agentStep = createStep({
        id: 'agent-step',
        inputSchema: mastraWorkflowInputSchema,
        outputSchema: mastraWorkflowOutputSchema,
        execute: async ({ inputData, mastra, writer }) => {
          const { messages } = inputData;
          const agent = mastra?.getAgent('calculatorAgent');

          if (!agent) {
            return { success: false, finalAnswer: 'Agent not found', conversationHistory: [] };
          }

          const stream = await agent.stream(messages as Parameters<typeof agent.stream>[0]);
          const { text } = await pipeFullStreamWithToolEvents(stream, writer!);

          return {
            success: true,
            finalAnswer: text,
            conversationHistory: [],
          };
        },
      });

      // Create workflow
      const workflow = createWorkflow({
        id: 'calculator-workflow',
        inputSchema: mastraWorkflowInputSchema,
        outputSchema: mastraWorkflowOutputSchema,
      })
        .then(agentStep)
        .commit();

      // Create Mastra instance
      const mastra = new Mastra({
        agents: { calculatorAgent: testAgent },
        workflows: { 'calculator-workflow': workflow },
      });

      // Create MastraWorkflowAgent
      const agent = new MastraWorkflowAgent(mastra, {
        workflowId: 'calculator-workflow',
        agentName: 'calculator-test',
      });

      // Run the test
      const session = createMockSession();
      const events = createMockEventEmitter();
      const messages = [{ role: 'user', content: 'What is 15 * 7?' }];
      const input = createAgentInput(session, messages);

      const result = await agent.run(input, events);

      // Assertions
      expect(result.success).toBe(true);

      // Check event types
      const eventTypes = events.events.map((e) => e.type);
      expect(eventTypes).toContain(EventType.RUN_STARTED);
      expect(eventTypes).toContain(EventType.MESSAGES_SNAPSHOT);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_START);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_CONTENT);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_END);
      expect(eventTypes).toContain(EventType.RUN_FINISHED);

      // Check TOOL_CALL events were emitted (calculator tool should be called)
      expect(eventTypes).toContain(EventType.TOOL_CALL_START);
      expect(eventTypes).toContain(EventType.TOOL_CALL_ARGS);
      expect(eventTypes).toContain(EventType.TOOL_CALL_END);

      // Verify tool call details
      const toolCallStartEvent = events.events.find(
        (e): e is ToolCallStartEvent => e.type === EventType.TOOL_CALL_START
      );
      expect(toolCallStartEvent).toBeDefined();
      expect(toolCallStartEvent!.toolCallName).toBe('calculator');
      expect(toolCallStartEvent!.toolCallId).toBeDefined();

      // Check tool call args contain the expression
      const toolCallArgsEvents = events.events.filter(
        (e): e is ToolCallArgsEvent => e.type === EventType.TOOL_CALL_ARGS
      );
      const combinedArgs = toolCallArgsEvents.map((e) => e.delta).join('');
      expect(combinedArgs).toContain('15');
      expect(combinedArgs).toContain('7');

      // Check streaming occurred
      const textContentEvents = events.events.filter(
        (e): e is TextMessageContentEvent => e.type === EventType.TEXT_MESSAGE_CONTENT
      );
      expect(textContentEvents.length).toBeGreaterThan(0);

      // Check combined text contains correct answer
      const combinedText = textContentEvents.map((e) => e.delta).join('');
      expect(combinedText).toContain('105');
    }, 30000);

    it('should stream responses and emit correct AG-UI events with client-side tools', async () => {
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!,
      });

      // Define calculator tool in use-ai ToolDefinition format (JSON Schema)
      // This is how tools are defined on the client side in production
      const calculatorToolDefinition: ToolDefinition = {
        name: 'calculator',
        description: 'Calculate a mathematical expression',
        parameters: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description: 'The expression to evaluate',
            },
          },
          required: ['expression'],
        },
      };

      // Create agent WITHOUT tools - tools will come from client via inputData.clientTools
      const testAgent = new Agent({
        id: 'calculator-agent',
        name: 'calculatorAgent',
        model: anthropic('claude-haiku-4-5'),
        instructions: 'You are a helpful assistant. Use the calculator tool for math.',
        tools: {},
      });

      // Create workflow step that uses clientTools from inputData
      // This is the production pattern - tools are passed via convertToolsToAISDKFormat
      const agentStep = createStep({
        id: 'agent-step',
        inputSchema: mastraWorkflowInputSchema,
        outputSchema: mastraWorkflowOutputSchema,
        execute: async ({ inputData, mastra, writer }) => {
          const { messages, clientTools } = inputData;
          const agent = mastra?.getAgent('calculatorAgent');

          if (!agent) {
            return { success: false, finalAnswer: 'Agent not found', conversationHistory: [] };
          }

          // Pass clientTools via toolsets - these come from convertToolsToAISDKFormat
          const stream = await agent.stream(messages as Parameters<typeof agent.stream>[0], {
            toolsets: clientTools ? { client: clientTools } : undefined,
          });
          const { text } = await pipeFullStreamWithToolEvents(stream, writer!);

          return {
            success: true,
            finalAnswer: text,
            conversationHistory: [],
          };
        },
      });

      // Create workflow
      const workflow = createWorkflow({
        id: 'calculator-workflow',
        inputSchema: mastraWorkflowInputSchema,
        outputSchema: mastraWorkflowOutputSchema,
      })
        .then(agentStep)
        .commit();

      // Create Mastra instance
      const mastra = new Mastra({
        agents: { calculatorAgent: testAgent },
        workflows: { 'calculator-workflow': workflow },
      });

      // Create MastraWorkflowAgent
      const agent = new MastraWorkflowAgent(mastra, {
        workflowId: 'calculator-workflow',
        agentName: 'calculator-test',
      });

      // Set up session and event emitter
      const session = createMockSession();
      const events: AGUIEvent[] = [];

      // Track tool call args to reconstruct full arguments
      const toolCallArgsBuffer: Map<string, string> = new Map();

      // Create event emitter that simulates client-side tool execution
      // In production, the client receives TOOL_CALL_END, executes the tool,
      // and sends back the result via socket which resolves pendingToolCalls
      const eventEmitter: EventEmitter = {
        emit: (event) => {
          events.push(event as AGUIEvent);

          // Accumulate tool call args
          if (event.type === EventType.TOOL_CALL_ARGS) {
            const argsEvent = event as ToolCallArgsEvent;
            const current = toolCallArgsBuffer.get(argsEvent.toolCallId) || '';
            toolCallArgsBuffer.set(argsEvent.toolCallId, current + argsEvent.delta);
          }

          // Simulate client-side tool execution on TOOL_CALL_END.
          // setTimeout is required because the AI SDK emits tool-call chunk
          // before calling execute(), so pendingToolCalls isn't set yet.
          if (event.type === EventType.TOOL_CALL_END) {
            const { toolCallId } = event as ToolCallEndEvent;

            // Get accumulated args
            const argsJson = toolCallArgsBuffer.get(toolCallId) || '{}';
            const args = JSON.parse(argsJson) as { expression: string };

            setTimeout(() => {
              const resolver = session.pendingToolCalls.get(toolCallId);
              if (resolver) {
                // Execute the tool (simulating client-side execution)
                const result = executeCalculator(args.expression);

                // Resolve the pending promise (simulating client sending tool_result)
                resolver(JSON.stringify(result));
                session.pendingToolCalls.delete(toolCallId);
              }
            }, 100);
          }
        },
      };

      // Run the test with tool definitions passed via input.tools
      const messages = [{ role: 'user', content: 'What is 15 * 7?' }];
      const input = createAgentInput(session, messages);
      input.tools = [calculatorToolDefinition]; // Pass tool definition like client would

      const result = await agent.run(input, eventEmitter);

      // Assertions
      expect(result.success).toBe(true);

      // Check event types
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain(EventType.RUN_STARTED);
      expect(eventTypes).toContain(EventType.MESSAGES_SNAPSHOT);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_START);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_CONTENT);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_END);
      expect(eventTypes).toContain(EventType.RUN_FINISHED);

      // Check TOOL_CALL events were emitted (calculator tool should be called)
      expect(eventTypes).toContain(EventType.TOOL_CALL_START);
      expect(eventTypes).toContain(EventType.TOOL_CALL_ARGS);
      expect(eventTypes).toContain(EventType.TOOL_CALL_END);

      // Verify tool call details
      const toolCallStartEvent = events.find(
        (e): e is ToolCallStartEvent => e.type === EventType.TOOL_CALL_START
      );
      expect(toolCallStartEvent).toBeDefined();
      expect(toolCallStartEvent!.toolCallName).toBe('calculator');
      expect(toolCallStartEvent!.toolCallId).toBeDefined();

      // Check tool call args contain the expression
      const toolCallArgsEvents = events.filter(
        (e): e is ToolCallArgsEvent => e.type === EventType.TOOL_CALL_ARGS
      );
      const combinedArgs = toolCallArgsEvents.map((e) => e.delta).join('');
      expect(combinedArgs).toContain('15');
      expect(combinedArgs).toContain('7');

      // Check streaming occurred
      const textContentEvents = events.filter(
        (e): e is TextMessageContentEvent => e.type === EventType.TEXT_MESSAGE_CONTENT
      );
      expect(textContentEvents.length).toBeGreaterThan(0);

      // Check combined text contains correct answer
      const combinedText = textContentEvents.map((e) => e.delta).join('');
      expect(combinedText).toContain('105');
    }, 30000);
  });

  describe('Non-streaming workflow (fallback)', () => {
    it('should emit text message when using generate instead of stream', async () => {
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!,
      });

      // Create agent without tools
      const simpleAgent = new Agent({
        id: 'simple-agent',
        name: 'simpleAgent',
        model: anthropic('claude-haiku-4-5'),
        instructions: 'You are a helpful assistant. Keep responses very brief.',
        tools: {},
      });

      // Non-streaming step
      const nonStreamingStep = createStep({
        id: 'non-streaming-step',
        inputSchema: mastraWorkflowInputSchema,
        outputSchema: mastraWorkflowOutputSchema,
        execute: async ({ inputData, mastra }) => {
          const { messages } = inputData;
          const agent = mastra?.getAgent('simpleAgent');

          if (!agent) {
            return { success: false, finalAnswer: 'Agent not found', conversationHistory: [] };
          }

          const response = await agent.generate(messages as Parameters<typeof agent.generate>[0]);

          return {
            success: true,
            finalAnswer: response.text,
            conversationHistory: [],
          };
        },
      });

      const workflow = createWorkflow({
        id: 'non-streaming-workflow',
        inputSchema: mastraWorkflowInputSchema,
        outputSchema: mastraWorkflowOutputSchema,
      })
        .then(nonStreamingStep)
        .commit();

      const mastra = new Mastra({
        agents: { simpleAgent },
        workflows: { 'non-streaming-workflow': workflow },
      });

      const agent = new MastraWorkflowAgent(mastra, {
        workflowId: 'non-streaming-workflow',
        agentName: 'non-streaming-test',
      });

      const session = createMockSession();
      const events = createMockEventEmitter();
      const messages = [{ role: 'user', content: 'Say hi' }];
      const input = createAgentInput(session, messages);

      const result = await agent.run(input, events);

      expect(result.success).toBe(true);

      const textContentEvents = events.events.filter(
        (e): e is TextMessageContentEvent => e.type === EventType.TEXT_MESSAGE_CONTENT
      );
      expect(textContentEvents.length).toBeGreaterThanOrEqual(1);
    }, 30000);
  });

  describe('Tool with no arguments', () => {
    it('should emit TOOL_CALL_ARGS with empty object for tools without arguments', async () => {
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!,
      });

      // Create a tool with NO arguments
      const getCurrentTimeTool = tool({
        description: 'Get the current server time. Call this tool to get the time.',
        inputSchema: z.object({}), // Empty schema - no arguments
        execute: async () => ({ time: '2024-01-15T10:30:00Z' }),
      });

      // Create agent with the no-argument tool
      const testAgent = new Agent({
        id: 'time-agent',
        name: 'timeAgent',
        model: anthropic('claude-haiku-4-5'),
        instructions: 'You MUST use the getCurrentTime tool to get the time. Always call the tool first.',
        tools: { getCurrentTime: getCurrentTimeTool },
      });

      // Create workflow step using pipeFullStreamWithToolEvents helper
      const agentStep = createStep({
        id: 'agent-step',
        inputSchema: mastraWorkflowInputSchema,
        outputSchema: mastraWorkflowOutputSchema,
        execute: async ({ inputData, mastra, writer }) => {
          const { messages } = inputData;
          const agent = mastra?.getAgent('timeAgent');

          if (!agent) {
            return { success: false, finalAnswer: 'Agent not found', conversationHistory: [] };
          }

          const stream = await agent.stream(messages as Parameters<typeof agent.stream>[0]);
          const { text } = await pipeFullStreamWithToolEvents(stream, writer!);

          return {
            success: true,
            finalAnswer: text,
            conversationHistory: [],
          };
        },
      });

      // Create workflow
      const workflow = createWorkflow({
        id: 'time-workflow',
        inputSchema: mastraWorkflowInputSchema,
        outputSchema: mastraWorkflowOutputSchema,
      })
        .then(agentStep)
        .commit();

      // Create Mastra instance
      const mastra = new Mastra({
        agents: { timeAgent: testAgent },
        workflows: { 'time-workflow': workflow },
      });

      // Create MastraWorkflowAgent
      const agent = new MastraWorkflowAgent(mastra, {
        workflowId: 'time-workflow',
        agentName: 'time-test',
      });

      // Run the test
      const session = createMockSession();
      const events = createMockEventEmitter();
      const messages = [{ role: 'user', content: 'What time is it?' }];
      const input = createAgentInput(session, messages);

      const result = await agent.run(input, events);

      // Assertions
      expect(result.success).toBe(true);

      // Check event types
      const eventTypes = events.events.map((e) => e.type);
      expect(eventTypes).toContain(EventType.RUN_STARTED);
      expect(eventTypes).toContain(EventType.RUN_FINISHED);

      // Check TOOL_CALL events were emitted
      expect(eventTypes).toContain(EventType.TOOL_CALL_START);
      expect(eventTypes).toContain(EventType.TOOL_CALL_ARGS);
      expect(eventTypes).toContain(EventType.TOOL_CALL_END);

      // Verify tool call details
      const toolCallStartEvent = events.events.find(
        (e): e is ToolCallStartEvent => e.type === EventType.TOOL_CALL_START
      );
      expect(toolCallStartEvent).toBeDefined();
      expect(toolCallStartEvent!.toolCallName).toBe('getCurrentTime');

      // CRITICAL: Verify that TOOL_CALL_ARGS contains valid JSON
      // Without the fix, tools with no arguments would not emit TOOL_CALL_ARGS,
      // causing JSON.parse('') to fail on the client side
      const toolCallArgsEvents = events.events.filter(
        (e): e is ToolCallArgsEvent => e.type === EventType.TOOL_CALL_ARGS
      );
      expect(toolCallArgsEvents.length).toBeGreaterThan(0);

      // Combine all args deltas and verify it's valid JSON
      const combinedArgs = toolCallArgsEvents.map((e) => e.delta).join('');
      expect(() => JSON.parse(combinedArgs)).not.toThrow();

      // The parsed args should be an empty object (or object with no required fields)
      const parsedArgs = JSON.parse(combinedArgs);
      expect(typeof parsedArgs).toBe('object');

      // Check the response mentions the time
      const textContentEvents = events.events.filter(
        (e): e is TextMessageContentEvent => e.type === EventType.TEXT_MESSAGE_CONTENT
      );
      const combinedText = textContentEvents.map((e) => e.delta).join('');
      expect(combinedText).toContain('10:30');
    }, 30000);
  });

  describe('Remote MCP Tool Execution', () => {
    it('should execute remote MCP tools directly on the server without client delegation', async () => {
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!,
      });

      // 1. Create a mock remote provider
      const mockExecuteTool = mock((_name, args) => Promise.resolve({ weather: 'Sunny, 25C', location: args.city }));
      const mockProvider = {
        executeTool: mockExecuteTool,
      };

      // 2. Define a "Remote" ToolDefinition
      // We manually construct this to match what RemoteMcpToolsProvider produces
      const weatherToolDefinition: ToolDefinition & { _remote: any } = {
        name: 'get_weather',
        description: 'Get current weather for a city',
        parameters: {
          type: 'object',
          properties: {
            city: {
              type: 'string',
              description: 'City name',
            },
          },
          required: ['city'],
        },
        _remote: {
          provider: mockProvider,
          originalName: 'get_weather',
        },
      };

      // 3. Create Mastra Agent
      // Note: We don't need to add the tool to the Mastra agent here essentially,
      // because MastraWorkflowAgent passes tools dynamically via 'clientTools'.
      // HOWEVER, the Mastra agent needs to know about the tool to use it in the prompt/planning.
      // But wait, the `clientTools` passed to `agent.stream({ toolsets: { client: ... } })`
      // ARE the tools the agent sees? Yes, for `client` toolset.
      // So we just need a basic agent.
      const testAgent = new Agent({
        id: 'weather-agent',
        name: 'weatherAgent',
        model: anthropic('claude-haiku-4-5'),
        instructions: 'You are a weather assistant. Use the get_weather tool.',
        tools: {},
      });

      // 4. Create proper workflow step
      const agentStep = createStep({
        id: 'weather-step',
        inputSchema: mastraWorkflowInputSchema,
        outputSchema: mastraWorkflowOutputSchema,
        execute: async ({ inputData, mastra, writer }) => {
          const { messages, clientTools } = inputData;
          const agent = mastra?.getAgent('weatherAgent');

          if (!agent) throw new Error('Agent not found');

          // Pass the converted tools (which includes our remote tool wrapper) as client tools
          const stream = await agent.stream(messages as Parameters<typeof agent.stream>[0], {
            toolsets: clientTools ? { client: clientTools } : undefined,
          });
          const { text } = await pipeFullStreamWithToolEvents(stream, writer!);

          return {
            success: true,
            finalAnswer: text,
            conversationHistory: [],
          };
        },
      });

      const workflow = createWorkflow({
        id: 'weather-workflow',
        inputSchema: mastraWorkflowInputSchema,
        outputSchema: mastraWorkflowOutputSchema,
      })
        .then(agentStep)
        .commit();

      const mastra = new Mastra({
        agents: { weatherAgent: testAgent },
        workflows: { 'weather-workflow': workflow },
      });

      const agent = new MastraWorkflowAgent(mastra, {
        workflowId: 'weather-workflow',
        agentName: 'weather-test',
      });

      const session = createMockSession();
      const events = createMockEventEmitter();
      const messages = [{ role: 'user', content: 'What is the weather in Tokyo?' }];
      const input = createAgentInput(session, messages);
      input.tools = [weatherToolDefinition]; // Pass our remote tool here

      // 5. Run the agent
      const result = await agent.run(input, events);

      // 6. Verification
      expect(result.success).toBe(true);

      // Verify server-side execution was called
      expect(mockExecuteTool).toHaveBeenCalled();
      // Verify arguments
      expect(mockExecuteTool.mock.calls[0][1]).toEqual({ city: 'Tokyo' });

      // Verify the response contains the weather info from our mock
      const textContentEvents = events.events.filter(
        (e): e is TextMessageContentEvent => e.type === EventType.TEXT_MESSAGE_CONTENT
      );
      const combinedText = textContentEvents.map((e) => e.delta).join('');
      // The model should use the tool result "Sunny, 25C" in its answer
      expect(combinedText).toContain('Sunny');
      // Model might format 25C as 25°C or similar
      expect(combinedText).toMatch(/25.*C/);
    }, 30000);
  });
});
