import { io, Socket } from 'socket.io-client';
import type {
  ClientMessage,
  AGUIEvent,
  RunAgentInput,
  Tool,
  Message as AGUIMessage,
} from '../src/types';
import { EventType } from '../src/types';
import { v4 as uuidv4 } from 'uuid';

// AI SDK result type
export type MockGenerateTextResult = {
  text: string;
  toolCalls?: Array<{ toolCallId: string; toolName: string; input: any }>;
  toolResults?: Array<{ toolCallId: string; toolName: string; output: any }>;
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  response: {
    messages: Array<{ role: string; content: string | any[] }>;
  };
  warnings?: any[];
};

/**
 * Wait for Socket.IO connection to be established
 */
export function waitForConnection(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
}

/**
 * Wait for an AG-UI event from the Socket.IO server
 */
export function waitForEvent(socket: Socket, timeout = 5000): Promise<AGUIEvent> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Event timeout'));
    }, timeout);

    socket.once('event', (event: AGUIEvent) => {
      clearTimeout(timeoutId);
      resolve(event);
    });
  });
}

/**
 * Wait for a specific AG-UI event type
 */
export function waitForEventType(
  socket: Socket,
  eventType: EventType,
  timeout = 5000
): Promise<AGUIEvent> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout waiting for event type: ${eventType}`));
    }, timeout);

    const handler = (event: AGUIEvent) => {
      if (event.type === eventType) {
        clearTimeout(timeoutId);
        socket.off('event', handler);
        resolve(event);
      }
    };

    socket.on('event', handler);
  });
}

/**
 * Collect all events until a specific event type is received
 */
export function collectEventsUntil(
  socket: Socket,
  stopEventType: EventType,
  timeout = 5000
): Promise<AGUIEvent[]> {
  return new Promise((resolve, reject) => {
    const events: AGUIEvent[] = [];
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout waiting for event type: ${stopEventType}`));
    }, timeout);

    const handler = (event: AGUIEvent) => {
      events.push(event);
      if (event.type === stopEventType) {
        clearTimeout(timeoutId);
        socket.off('event', handler);
        resolve(events);
      }
    };

    socket.on('event', handler);
  });
}

/**
 * Send a RunAgentInput message to the Socket.IO server
 */
export function sendRunAgent(
  socket: Socket,
  options: {
    prompt: string;
    tools?: Tool[];
    state?: unknown;
    threadId?: string;
    previousMessages?: AGUIMessage[];
  }
): void {
  const { prompt, tools = [], state = null, threadId = uuidv4(), previousMessages = [] } = options;

  const messages: AGUIMessage[] = [
    ...previousMessages,
    {
      id: uuidv4(),
      role: 'user',
      content: prompt,
    },
  ];

  const runInput: RunAgentInput = {
    threadId,
    runId: uuidv4(),
    messages,
    tools,
    state,
    context: [],
    forwardedProps: {},
  };

  const message: ClientMessage = {
    type: 'run_agent',
    data: runInput,
  };

  socket.emit('message', message);
}

/**
 * Send a tool result back to the server
 */
export function sendToolResult(
  socket: Socket,
  toolCallId: string,
  result: unknown
): void {
  const message: ClientMessage = {
    type: 'tool_result',
    data: {
      messageId: uuidv4(),
      toolCallId,
      content: JSON.stringify(result),
      role: 'tool',
    },
  };

  socket.emit('message', message);
}

/**
 * Create a Socket.IO client connected to the test server (WebSocket transport)
 */
export async function createTestClient(port: number): Promise<Socket> {
  const socket = io(`http://localhost:${port}`, {
    transports: ['websocket'],
  });
  await waitForConnection(socket);
  return socket;
}

/**
 * Create a Socket.IO client connected to the test server (Polling transport only)
 */
export async function createPollingTestClient(port: number): Promise<Socket> {
  const socket = io(`http://localhost:${port}`, {
    transports: ['polling'],
    upgrade: false, // Prevent upgrade to WebSocket
  });
  await waitForConnection(socket);
  return socket;
}

/**
 * Create a mock AI SDK generateText result
 */
export function createMockGenerateTextResult(
  text: string,
  toolCalls?: Array<{ toolCallId: string; toolName: string; input: any }>
): MockGenerateTextResult {
  return {
    text,
    toolCalls: toolCalls || [],
    finishReason: toolCalls && toolCalls.length > 0 ? 'tool-calls' : 'stop',
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    },
    response: {
      messages: text ? [{ role: 'assistant', content: text }] : [],
    },
  };
}

/**
 * Create a mock text response
 */
export function createTextResponse(id: string, text: string): MockGenerateTextResult {
  const result = createMockGenerateTextResult(text);
  result.response.messages = [{ role: 'assistant', content: text }];
  return result;
}

/**
 * Create a mock tool use response
 */
export function createToolUseResponse(
  id: string,
  toolCallId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): MockGenerateTextResult {
  const result = createMockGenerateTextResult('', [
    {
      toolCallId,
      toolName,
      input: toolInput,
    },
  ]);
  result.response.messages = [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId, toolName, input: toolInput }] }
  ];
  return result;
}

/**
 * Create a mock text response after tool execution
 */
export function createTextAfterToolResponse(id: string, text: string): MockGenerateTextResult {
  const result = createMockGenerateTextResult(text);
  result.response.messages = [{ role: 'assistant', content: text }];
  return result;
}

/**
 * Create a mock response with multiple tool uses
 */
export function createMultipleToolUseResponse(
  id: string,
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>
): MockGenerateTextResult {
  const result = createMockGenerateTextResult(
    '',
    toolCalls.map(call => ({
      toolCallId: call.id,
      toolName: call.name,
      input: call.input,
    }))
  );
  result.response.messages = [
    {
      role: 'assistant',
      content: toolCalls.map(call => ({
        type: 'tool-call',
        toolCallId: call.id,
        toolName: call.name,
        input: call.input,
      }))
    }
  ];
  return result;
}

/**
 * Helper to extract text content from AG-UI TEXT_MESSAGE events
 */
export function extractTextFromEvents(events: AGUIEvent[]): string {
  return events
    .filter(e => e.type === EventType.TEXT_MESSAGE_CONTENT)
    .map((e: any) => e.delta)
    .join('');
}

/**
 * Helper to find tool call events and extract tool call data
 */
export function extractToolCallsFromEvents(events: AGUIEvent[]): Array<{
  toolCallId: string;
  toolCallName: string;
  args: Record<string, unknown>;
}> {
  const toolCallStarts = events.filter(e => e.type === EventType.TOOL_CALL_START) as any[];
  const toolCallArgs = events.filter(e => e.type === EventType.TOOL_CALL_ARGS) as any[];

  return toolCallStarts.map(start => {
    const argsEvent = toolCallArgs.find((a: any) => a.toolCallId === start.toolCallId);
    const args = argsEvent ? JSON.parse(argsEvent.delta) : {};
    return {
      toolCallId: start.toolCallId,
      toolCallName: start.toolCallName,
      args,
    };
  });
}
