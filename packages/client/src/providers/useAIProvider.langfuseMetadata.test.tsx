import React from 'react';
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { render, act, waitFor } from '@testing-library/react';
import type { Socket } from 'socket.io-client';

// Store event handlers and captured data
let eventHandlers: Record<string, Function[]> = {};
let mockSocket: Partial<Socket> & { connected: boolean };
let capturedEmitCalls: Array<{ event: string; data: unknown }> = [];

function createMockSocket() {
  eventHandlers = {};
  capturedEmitCalls = [];
  mockSocket = {
    on: mock((event: string, handler: Function) => {
      if (!eventHandlers[event]) eventHandlers[event] = [];
      eventHandlers[event].push(handler);
      return mockSocket as Socket;
    }),
    emit: mock((event: string, data: unknown) => {
      capturedEmitCalls.push({ event, data });
      return mockSocket as Socket;
    }),
    connected: false,
    disconnect: mock(() => mockSocket as Socket),
    io: {
      engine: {
        transport: { name: 'websocket' },
        on: mock(),
      },
    } as unknown,
  };
  return mockSocket as Socket;
}

function emitSocketEvent(event: string, ...args: unknown[]) {
  eventHandlers[event]?.forEach((handler) => handler(...args));
}

function getLastRunAgentCall() {
  const runAgentCalls = capturedEmitCalls.filter(
    (call) => call.event === 'message' && (call.data as { type: string }).type === 'run_agent'
  );
  return runAgentCalls[runAgentCalls.length - 1]?.data as {
    type: string;
    data: { forwardedProps: Record<string, unknown> };
  } | undefined;
}

// Mock socket.io-client module
mock.module('socket.io-client', () => ({
  io: () => createMockSocket(),
}));

// Import after mocking
const { UseAIProvider, useAIContext } = await import('./useAIProvider');

// Test component that exposes sendMessage via context
function TestConsumer({
  onReady,
}: {
  onReady: (sendMessage: (msg: string, opts?: { langfuseMetadata?: Record<string, unknown> }) => Promise<void>) => void;
}) {
  const { chat, connected } = useAIContext();

  React.useEffect(() => {
    if (connected) {
      onReady(chat.sendMessage);
    }
  }, [connected, chat.sendMessage, onReady]);

  return <div data-testid="consumer">Connected: {String(connected)}</div>;
}

describe('UseAIProvider langfuseMetadata', () => {
  beforeEach(() => {
    createMockSocket();
  });

  afterEach(() => {
    capturedEmitCalls = [];
  });

  test('sends langfuseMetadata from provider only', async () => {
    let sendMessage: ((msg: string, opts?: { langfuseMetadata?: Record<string, unknown> }) => Promise<void>) | null = null;

    render(
      <UseAIProvider
        serverUrl="http://localhost:8081"
        langfuseMetadataProvider={() => ({
          userId: 'provider-user-123',
          tenantId: 'tenant-abc',
        })}
        renderChat={false}
      >
        <TestConsumer
          onReady={(fn) => {
            sendMessage = fn;
          }}
        />
      </UseAIProvider>
    );

    // Simulate connection
    await act(async () => {
      mockSocket.connected = true;
      emitSocketEvent('connect');
    });

    // Wait for sendMessage to be available
    await waitFor(() => expect(sendMessage).not.toBeNull());

    // Send message without message-level langfuseMetadata
    await act(async () => {
      await sendMessage!('Hello');
    });

    const lastCall = getLastRunAgentCall();
    expect(lastCall).toBeDefined();
    expect(lastCall!.data.forwardedProps.langfuseMetadata).toEqual({
      userId: 'provider-user-123',
      tenantId: 'tenant-abc',
    });
  });

  test('sends langfuseMetadata from sendMessage only', async () => {
    let sendMessage: ((msg: string, opts?: { langfuseMetadata?: Record<string, unknown> }) => Promise<void>) | null = null;

    render(
      <UseAIProvider serverUrl="http://localhost:8081" renderChat={false}>
        <TestConsumer
          onReady={(fn) => {
            sendMessage = fn;
          }}
        />
      </UseAIProvider>
    );

    await act(async () => {
      mockSocket.connected = true;
      emitSocketEvent('connect');
    });

    await waitFor(() => expect(sendMessage).not.toBeNull());

    // Send message with message-level langfuseMetadata only
    await act(async () => {
      await sendMessage!('Hello', {
        langfuseMetadata: {
          evaluationId: 'eval-456',
          customKey: 'custom-value',
        },
      });
    });

    const lastCall = getLastRunAgentCall();
    expect(lastCall).toBeDefined();
    expect(lastCall!.data.forwardedProps.langfuseMetadata).toEqual({
      evaluationId: 'eval-456',
      customKey: 'custom-value',
    });
  });

  test('merges langfuseMetadata with message-level taking precedence', async () => {
    let sendMessage: ((msg: string, opts?: { langfuseMetadata?: Record<string, unknown> }) => Promise<void>) | null = null;

    render(
      <UseAIProvider
        serverUrl="http://localhost:8081"
        langfuseMetadataProvider={() => ({
          userId: 'provider-user',
          tenantId: 'provider-tenant',
          sharedKey: 'provider-value',
        })}
        renderChat={false}
      >
        <TestConsumer
          onReady={(fn) => {
            sendMessage = fn;
          }}
        />
      </UseAIProvider>
    );

    await act(async () => {
      mockSocket.connected = true;
      emitSocketEvent('connect');
    });

    await waitFor(() => expect(sendMessage).not.toBeNull());

    // Send message with message-level langfuseMetadata that overrides some keys
    await act(async () => {
      await sendMessage!('Hello', {
        langfuseMetadata: {
          evaluationId: 'eval-789',
          sharedKey: 'message-value', // This should override provider's value
        },
      });
    });

    const lastCall = getLastRunAgentCall();
    expect(lastCall).toBeDefined();
    expect(lastCall!.data.forwardedProps.langfuseMetadata).toEqual({
      userId: 'provider-user', // From provider
      tenantId: 'provider-tenant', // From provider
      sharedKey: 'message-value', // Overridden by message-level
      evaluationId: 'eval-789', // From message-level
    });
  });

  test('sends empty forwardedProps when neither provider nor message-level langfuseMetadata', async () => {
    let sendMessage: ((msg: string, opts?: { langfuseMetadata?: Record<string, unknown> }) => Promise<void>) | null = null;

    render(
      <UseAIProvider serverUrl="http://localhost:8081" renderChat={false}>
        <TestConsumer
          onReady={(fn) => {
            sendMessage = fn;
          }}
        />
      </UseAIProvider>
    );

    await act(async () => {
      mockSocket.connected = true;
      emitSocketEvent('connect');
    });

    await waitFor(() => expect(sendMessage).not.toBeNull());

    // Send message without any langfuseMetadata
    await act(async () => {
      await sendMessage!('Hello');
    });

    const lastCall = getLastRunAgentCall();
    expect(lastCall).toBeDefined();
    // forwardedProps should not contain langfuseMetadata (or be empty object)
    expect(lastCall!.data.forwardedProps.langfuseMetadata).toBeUndefined();
  });

  test('supports async langfuseMetadataProvider', async () => {
    let sendMessage: ((msg: string, opts?: { langfuseMetadata?: Record<string, unknown> }) => Promise<void>) | null = null;

    render(
      <UseAIProvider
        serverUrl="http://localhost:8081"
        langfuseMetadataProvider={async () => {
          // Simulate async operation (e.g., fetching from API)
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            asyncUserId: 'async-user-123',
          };
        }}
        renderChat={false}
      >
        <TestConsumer
          onReady={(fn) => {
            sendMessage = fn;
          }}
        />
      </UseAIProvider>
    );

    await act(async () => {
      mockSocket.connected = true;
      emitSocketEvent('connect');
    });

    await waitFor(() => expect(sendMessage).not.toBeNull());

    await act(async () => {
      await sendMessage!('Hello');
    });

    const lastCall = getLastRunAgentCall();
    expect(lastCall).toBeDefined();
    expect(lastCall!.data.forwardedProps.langfuseMetadata).toEqual({
      asyncUserId: 'async-user-123',
    });
  });
});
