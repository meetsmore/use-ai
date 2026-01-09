import { describe, it, expect, mock } from 'bun:test';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { Mastra } from '@mastra/core';
import { MastraWorkflowAgent } from './MastraWorkflowAgent';
import type { AgentInput, EventEmitter, ClientSession } from '@meetsmore-oss/use-ai-server';
import { EventType } from '@meetsmore-oss/use-ai-core';
import { v4 as uuidv4 } from 'uuid';
import { mastraWorkflowInputSchema, mastraWorkflowOutputSchema } from './types';

function createMockSession(): ClientSession {
  return {
    clientId: 'client-123',
    ipAddress: '127.0.0.1',
    socket: {} as never,
    threadId: 'thread-123',
    tools: [],
    state: null,
    conversationHistory: [],
    pendingToolCalls: new Map(),
  };
}

function createMockEventEmitter(): EventEmitter & { events: Array<{ type: string; [key: string]: unknown }> } {
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  return {
    events,
    emit: (event) => {
      events.push(event as { type: string; [key: string]: unknown });
    },
  };
}

function createAgentInput(session: ClientSession, overrides: Partial<AgentInput> = {}): AgentInput {
  const messages = [{ id: 'msg-1', role: 'user', content: 'Hello' }] as never[];
  return {
    session,
    runId: 'run-123',
    messages,
    tools: [],
    state: null,
    systemPrompt: 'Test prompt',
    originalInput: {
      threadId: 'thread-123',
      runId: 'run-123',
      messages: [{ id: uuidv4(), role: 'user' as const, content: 'Hello' }],
      tools: [],
      state: null,
      context: [],
    },
    ...overrides,
  };
}

// Streaming echo workflow - uses writer to stream chunks
const streamingEchoStep = createStep({
  id: 'streaming-echo',
  inputSchema: mastraWorkflowInputSchema,
  outputSchema: mastraWorkflowOutputSchema,
  execute: async ({ inputData, writer }) => {
    const { messages } = inputData;
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    const userText = typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : '';

    const responseText = `ECHO: ${userText.toUpperCase()}`;

    // Stream the response in chunks using writer
    if (writer) {
      const chunks = responseText.split(' ');
      for (let i = 0; i < chunks.length; i++) {
        const chunk = i === 0 ? chunks[i] : ' ' + chunks[i];
        await writer.write(chunk);
      }
    }

    return {
      success: true,
      finalAnswer: responseText,
      conversationHistory: [],
    };
  },
});

const streamingEchoWorkflow = createWorkflow({
  id: 'streaming-echo-workflow',
  inputSchema: mastraWorkflowInputSchema,
  outputSchema: mastraWorkflowOutputSchema,
})
  .then(streamingEchoStep)
  .commit();

// Non-streaming echo workflow - does not use writer (fallback behavior)
const echoStep = createStep({
  id: 'echo',
  inputSchema: mastraWorkflowInputSchema,
  outputSchema: mastraWorkflowOutputSchema,
  execute: async ({ inputData }) => {
    const { messages } = inputData;
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    const userText = typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : '';

    return {
      success: true,
      finalAnswer: `ECHO: ${userText.toUpperCase()}`,
      conversationHistory: [],
    };
  },
});

const echoWorkflow = createWorkflow({
  id: 'echo-workflow',
  inputSchema: mastraWorkflowInputSchema,
  outputSchema: mastraWorkflowOutputSchema,
})
  .then(echoStep)
  .commit();

// Workflow that throws an error during execution
const errorStep = createStep({
  id: 'error',
  inputSchema: mastraWorkflowInputSchema,
  outputSchema: mastraWorkflowOutputSchema,
  execute: async () => {
    throw new Error('Simulated Mastra API error');
  },
});

const errorWorkflow = createWorkflow({
  id: 'error-workflow',
  inputSchema: mastraWorkflowInputSchema,
  outputSchema: mastraWorkflowOutputSchema,
})
  .then(errorStep)
  .commit();

const mastra = new Mastra({
  workflows: {
    'echo-workflow': echoWorkflow,
    'streaming-echo-workflow': streamingEchoWorkflow,
    'error-workflow': errorWorkflow,
  },
});

describe('MastraWorkflowAgent Integration Tests', () => {
  describe('Streaming workflow', () => {
    it('should stream workflow output and emit multiple TEXT_MESSAGE_CONTENT events', async () => {
      const agent = new MastraWorkflowAgent(mastra, {
        workflowId: 'streaming-echo-workflow',
        agentName: 'streaming-echo',
      });
      const session = createMockSession();
      const events = createMockEventEmitter();

      const messages = [{ id: 'msg-1', role: 'user', content: 'hello world' }] as never[];
      const input = createAgentInput(session, { messages });

      const result = await agent.run(input, events);

      expect(result.success).toBe(true);

      // Verify correct events were emitted
      const eventTypes = events.events.map((e) => e.type);
      expect(eventTypes).toContain(EventType.RUN_STARTED);
      expect(eventTypes).toContain(EventType.MESSAGES_SNAPSHOT);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_START);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_CONTENT);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_END);
      expect(eventTypes).toContain(EventType.RUN_FINISHED);

      // Verify multiple TEXT_MESSAGE_CONTENT events (streaming)
      const textContentEvents = events.events.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
      expect(textContentEvents.length).toBeGreaterThan(1);

      // Verify the combined content equals the expected response
      const combinedText = textContentEvents.map((e) => e.delta).join('');
      expect(combinedText).toBe('ECHO: HELLO WORLD');
    });

    it('should emit events in correct order for streaming workflow', async () => {
      const agent = new MastraWorkflowAgent(mastra, {
        workflowId: 'streaming-echo-workflow',
        agentName: 'streaming-echo',
      });
      const session = createMockSession();
      const events = createMockEventEmitter();

      const messages = [{ id: 'msg-1', role: 'user', content: 'test' }] as never[];
      const input = createAgentInput(session, { messages });

      await agent.run(input, events);

      const eventTypes = events.events.map((e) => e.type);

      const runStartedIndex = eventTypes.indexOf(EventType.RUN_STARTED);
      const messagesSnapshotIndex = eventTypes.indexOf(EventType.MESSAGES_SNAPSHOT);
      const textStartIndex = eventTypes.indexOf(EventType.TEXT_MESSAGE_START);
      const textEndIndex = eventTypes.lastIndexOf(EventType.TEXT_MESSAGE_END);
      const runFinishedIndex = eventTypes.indexOf(EventType.RUN_FINISHED);

      expect(runStartedIndex).toBeLessThan(messagesSnapshotIndex);
      expect(messagesSnapshotIndex).toBeLessThan(textStartIndex);
      expect(textStartIndex).toBeLessThan(textEndIndex);
      expect(textEndIndex).toBeLessThan(runFinishedIndex);
    });
  });

  describe('Non-streaming workflow (fallback)', () => {
    it('should execute workflow and emit fallback text message', async () => {
      const agent = new MastraWorkflowAgent(mastra, { workflowId: 'echo-workflow', agentName: 'echo' });
      const session = createMockSession();
      const events = createMockEventEmitter();

      const messages = [{ id: 'msg-1', role: 'user', content: 'hello world' }] as never[];
      const input = createAgentInput(session, { messages });

      const result = await agent.run(input, events);

      expect(result.success).toBe(true);

      // Verify correct events were emitted
      const eventTypes = events.events.map((e) => e.type);
      expect(eventTypes).toContain(EventType.RUN_STARTED);
      expect(eventTypes).toContain(EventType.MESSAGES_SNAPSHOT);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_START);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_CONTENT);
      expect(eventTypes).toContain(EventType.TEXT_MESSAGE_END);
      expect(eventTypes).toContain(EventType.RUN_FINISHED);

      // Verify fallback behavior: single TEXT_MESSAGE_CONTENT event with full response
      const textContentEvents = events.events.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT);
      expect(textContentEvents.length).toBe(1);
      expect(textContentEvents[0]?.delta).toBe('ECHO: HELLO WORLD');
    });
  });

  describe('Error handling', () => {
    it('should emit RUN_ERROR when workflow not found', async () => {
      const agent = new MastraWorkflowAgent(mastra, {
        workflowId: 'non-existent-workflow',
        agentName: 'non-existent',
      });
      const session = createMockSession();
      const events = createMockEventEmitter();

      const input = createAgentInput(session);

      const result = await agent.run(input, events);

      expect(result.success).toBe(false);
      expect(result.error).toContain('non-existent-workflow');

      const eventTypes = events.events.map((e) => e.type);
      expect(eventTypes).toContain(EventType.RUN_ERROR);
    });

    it('should emit RUN_ERROR when workflow execution throws an error', async () => {
      const agent = new MastraWorkflowAgent(mastra, { workflowId: 'error-workflow', agentName: 'error' });
      const session = createMockSession();
      const events = createMockEventEmitter();

      const input = createAgentInput(session);

      const result = await agent.run(input, events);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      const eventTypes = events.events.map((e) => e.type);
      expect(eventTypes).toContain(EventType.RUN_STARTED);
      expect(eventTypes).toContain(EventType.MESSAGES_SNAPSHOT);
      expect(eventTypes).toContain(EventType.RUN_ERROR);
      // Should NOT emit RUN_FINISHED on error
      expect(eventTypes).not.toContain(EventType.RUN_FINISHED);

      // Verify error message is included
      const errorEvent = events.events.find((e) => e.type === EventType.RUN_ERROR);
      expect(errorEvent?.message).toBeDefined();
    });
  });
});
