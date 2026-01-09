/**
 * Client Integration Test Utilities
 *
 * Shared utilities for client integration tests to reduce code duplication.
 */

import React, { useMemo } from 'react';
import { SocketServerMock } from 'socket.io-mock-ts';
import { mock } from 'bun:test';
import { UseAIProvider } from '../src/providers/useAIProvider';
import type { AGUIEvent } from '../src/types';
import { EventType } from '../src/types';

// Store server mock for cleanup
let mockServer: SocketServerMock | null = null;
const sentMessages: any[] = [];

/**
 * Setup mock Socket.IO server for tests
 */
export function setupMockWebSocket(url: string = 'ws://localhost:8081'): {
  server: SocketServerMock;
  sentMessages: any[];
} {
  // Clear sent messages
  sentMessages.length = 0;

  // Create mock Socket.IO server
  mockServer = new SocketServerMock();

  // Set the client mock as connected
  (mockServer.clientMock as any).connected = true;
  (mockServer.clientMock as any).disconnected = false;

  // Track all messages sent by the client
  // The client sends all messages via socket.emit('message', { type, ...data })
  mockServer.on('message', (message: any) => {
    sentMessages.push(message);
  });

  // Mock socket.io-client module
  mock.module('socket.io-client', () => ({
    io: mock(() => {
      // Trigger connection event immediately
      setTimeout(() => {
        mockServer!.clientMock.fireEvent('connect');
      }, 0);
      return mockServer!.clientMock;
    }),
    Socket: class {}
  }));

  return { server: mockServer, sentMessages };
}

/**
 * Restore original Socket.IO client and close server
 */
export function restoreMockWebSocket(): void {
  if (mockServer) {
    mockServer.disconnect();
    mockServer = null;
  }
  sentMessages.length = 0;
  // Note: mock.module() mocks are automatically cleaned up between tests
}

/**
 * Get the current mock server
 */
export function getMockServer(): SocketServerMock | null {
  return mockServer;
}

/**
 * Simulate an AG-UI event from the server
 */
export function simulateEvent(event: AGUIEvent): void {
  if (!mockServer) {
    throw new Error('Mock server not initialized. Call setupMockWebSocket first.');
  }

  // Emit the event to the client
  mockServer.emit('event', event);
}

/**
 * Simulate a tool call sequence
 */
export function simulateToolCall(
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>
): void {
  simulateEvent({
    type: EventType.TOOL_CALL_START,
    toolCallId,
    toolCallName: toolName,
    parentMessageId: 'msg-test',
    timestamp: Date.now(),
  });

  simulateEvent({
    type: EventType.TOOL_CALL_ARGS,
    toolCallId,
    delta: JSON.stringify(input),
    timestamp: Date.now(),
  });

  simulateEvent({
    type: EventType.TOOL_CALL_END,
    toolCallId,
    timestamp: Date.now(),
  });
}

/**
 * Simulate workflow success
 */
export function simulateWorkflowSuccess(
  runId: string,
  threadId: string,
  text: string = 'Workflow completed'
): void {
  simulateEvent({
    type: EventType.RUN_STARTED,
    threadId,
    runId,
    input: {
      threadId,
      runId,
      messages: [],
      tools: [],
      state: {},
    } as any,
    timestamp: Date.now(),
  });

  const messageId = 'msg-' + Math.random();
  simulateEvent({
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: 'assistant',
    timestamp: Date.now(),
  });

  simulateEvent({
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId,
    delta: text,
    timestamp: Date.now(),
  });

  simulateEvent({
    type: EventType.TEXT_MESSAGE_END,
    messageId,
    timestamp: Date.now(),
  });

  simulateEvent({
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
    result: text,
    timestamp: Date.now(),
  });
}

/**
 * Simulate workflow error
 */
export function simulateWorkflowError(message: string): void {
  simulateEvent({
    type: EventType.RUN_ERROR,
    message,
    timestamp: Date.now(),
  });
}

/**
 * Helper to create stable tools that don't cause re-renders
 */
export function useStableTools<T extends Record<string, any>>(tools: T): T {
  return useMemo(() => tools, []);
}

/**
 * Default test wrapper with UseAIProvider
 */
export function createTestWrapper(serverUrl: string = 'ws://localhost:8081') {
  return ({ children }: { children: React.ReactNode }) => (
    <UseAIProvider serverUrl={serverUrl}>{children}</UseAIProvider>
  );
}

/**
 * Find a sent message by type
 */
export function findSentMessage(messageType: string): any | undefined {
  return sentMessages.find(msg => msg.type === messageType);
}

/**
 * Find all sent messages by type
 */
export function findAllSentMessages(messageType: string): any[] {
  return sentMessages.filter(msg => msg.type === messageType);
}

/**
 * Get all sent messages
 */
export function getSentMessages(): any[] {
  return sentMessages;
}

/**
 * Parse tool result content
 */
export function parseToolResult(toolResult: any): any {
  if (!toolResult || !toolResult.data || !toolResult.data.content) {
    return null;
  }
  try {
    return JSON.parse(toolResult.data.content);
  } catch {
    return toolResult.data.content;
  }
}

/**
 * Simulate streaming text message
 */
export function simulateStreamingText(
  runId: string,
  threadId: string,
  textChunks: string[]
): void {
  simulateEvent({
    type: EventType.RUN_STARTED,
    threadId,
    runId,
    input: { threadId, runId, messages: [], tools: [], state: {} } as any,
    timestamp: Date.now(),
  });

  const messageId = 'msg-' + Math.random();

  simulateEvent({
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: 'assistant',
    timestamp: Date.now(),
  });

  textChunks.forEach(chunk => {
    simulateEvent({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: chunk,
      timestamp: Date.now(),
    });
  });

  simulateEvent({
    type: EventType.TEXT_MESSAGE_END,
    messageId,
    timestamp: Date.now(),
  });
}

/**
 * Simulate complete workflow with tool calls
 */
export function simulateWorkflowWithToolCalls(
  runId: string,
  threadId: string,
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }>,
  finalText: string = 'Complete'
): void {
  simulateEvent({
    type: EventType.RUN_STARTED,
    threadId,
    runId,
    input: {
      threadId,
      runId,
      messages: [],
      tools: [],
      state: {},
    } as any,
    timestamp: Date.now(),
  });

  // Simulate tool calls
  toolCalls.forEach(toolCall => {
    simulateToolCall(toolCall.toolCallId, toolCall.toolName, toolCall.args);
  });

  // Simulate final text response
  const messageId = 'msg-final';
  simulateEvent({
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: 'assistant',
    timestamp: Date.now(),
  });

  simulateEvent({
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId,
    delta: finalText,
    timestamp: Date.now(),
  });

  simulateEvent({
    type: EventType.TEXT_MESSAGE_END,
    messageId,
    timestamp: Date.now(),
  });

  simulateEvent({
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
    result: finalText,
    timestamp: Date.now(),
  });
}

/**
 * Extract tool result from sent messages
 */
export function getToolResultFromSentMessages(toolCallId: string): any {
  const toolResult = sentMessages.find(
    msg => msg.type === 'tool_result' && msg.data?.toolCallId === toolCallId
  );
  return toolResult ? parseToolResult(toolResult) : null;
}

/**
 * Assert tool result was sent
 */
export function assertToolResultSent(
  toolCallId: string,
  expectedData?: any
): void {
  const toolResult = sentMessages.find(
    msg => msg.type === 'tool_result' && msg.data?.toolCallId === toolCallId
  );

  if (!toolResult) {
    throw new Error(`Expected tool_result for ${toolCallId} to be sent, but it was not found`);
  }

  if (expectedData !== undefined) {
    const resultData = parseToolResult(toolResult);
    if (JSON.stringify(resultData) !== JSON.stringify(expectedData)) {
      throw new Error(
        `Tool result data mismatch. Expected: ${JSON.stringify(expectedData)}, Got: ${JSON.stringify(resultData)}`
      );
    }
  }
}
