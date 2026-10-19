import React from 'react';
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { render, act, waitFor } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import type { UseAIForwardedProps } from '../types';
import type { ForwardedPropsProviderContext } from './useAIProvider';
import type { PersistedMessage } from './chatRepository/types';

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
    data: { forwardedProps: UseAIForwardedProps };
  } | undefined;
}

// Mock socket.io-client module
mock.module('socket.io-client', () => ({
  io: () => createMockSocket(),
}));

// Import after mocking
const { UseAIProvider, useAIContext } = await import('./useAIProvider');
const { __UseAIChatContext } = await import('../components/UseAIChat');
const { LocalStorageChatRepository } = await import('./chatRepository/LocalStorageChatRepository');

// Test component that exposes sendMessage via context
function TestConsumer({
  onReady,
}: {
  onReady: (sendMessage: (msg: string, opts?: { forwardedProps?: UseAIForwardedProps }) => Promise<void>) => void;
}) {
  const { chat, connected } = useAIContext();

  React.useEffect(() => {
    if (connected) {
      onReady(chat.sendMessage);
    }
  }, [connected, chat.sendMessage, onReady]);

  return <div data-testid="consumer">Connected: {String(connected)}</div>;
}

describe('UseAIProvider forwardedPropsProvider', () => {
  beforeEach(() => {
    createMockSocket();
  });

  afterEach(() => {
    capturedEmitCalls = [];
  });

  test('sends telemetryMetadata from provider only', async () => {
    let sendMessage: ((msg: string, opts?: { forwardedProps?: UseAIForwardedProps }) => Promise<void>) | null = null;

    render(
      <UseAIProvider
        serverUrl="http://localhost:8081"
        forwardedPropsProvider={() => ({
          telemetryMetadata: {
            userId: 'provider-user-123',
            tenantId: 'tenant-abc',
          },
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

    // Send message without message-level forwardedProps
    await act(async () => {
      await sendMessage!('Hello');
    });

    const lastCall = getLastRunAgentCall();
    expect(lastCall).toBeDefined();
    expect(lastCall!.data.forwardedProps.telemetryMetadata).toEqual({
      userId: 'provider-user-123',
      tenantId: 'tenant-abc',
    });
  });

  test('sends forwardedProps from sendMessage only', async () => {
    let sendMessage: ((msg: string, opts?: { forwardedProps?: UseAIForwardedProps }) => Promise<void>) | null = null;

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

    // Send message with message-level forwardedProps only
    await act(async () => {
      await sendMessage!('Hello', {
        forwardedProps: {
          telemetryMetadata: {
            evaluationId: 'eval-456',
            customKey: 'custom-value',
          },
        },
      });
    });

    const lastCall = getLastRunAgentCall();
    expect(lastCall).toBeDefined();
    expect(lastCall!.data.forwardedProps.telemetryMetadata).toEqual({
      evaluationId: 'eval-456',
      customKey: 'custom-value',
    });
  });

  test('merges forwardedProps with message-level taking precedence', async () => {
    let sendMessage: ((msg: string, opts?: { forwardedProps?: UseAIForwardedProps }) => Promise<void>) | null = null;

    render(
      <UseAIProvider
        serverUrl="http://localhost:8081"
        forwardedPropsProvider={() => ({
          telemetryMetadata: {
            userId: 'provider-user',
            tenantId: 'provider-tenant',
          },
          customProviderKey: 'provider-value',
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

    // Send message with message-level forwardedProps that overrides some keys
    await act(async () => {
      await sendMessage!('Hello', {
        forwardedProps: {
          telemetryMetadata: {
            evaluationId: 'eval-789',
          },
          customProviderKey: 'message-value', // This should override provider's value
        },
      });
    });

    const lastCall = getLastRunAgentCall();
    expect(lastCall).toBeDefined();
    // message-level telemetryMetadata overrides provider's entirely (shallow merge at top level)
    expect(lastCall!.data.forwardedProps.telemetryMetadata).toEqual({
      evaluationId: 'eval-789',
    });
    // message-level customProviderKey overrides provider's
    expect(lastCall!.data.forwardedProps.customProviderKey).toBe('message-value');
  });

  test('sends empty forwardedProps when neither provider nor message-level props', async () => {
    let sendMessage: ((msg: string, opts?: { forwardedProps?: UseAIForwardedProps }) => Promise<void>) | null = null;

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

    // Send message without any forwardedProps
    await act(async () => {
      await sendMessage!('Hello');
    });

    const lastCall = getLastRunAgentCall();
    expect(lastCall).toBeDefined();
    expect(lastCall!.data.forwardedProps).toEqual({});
  });

  test('supports async forwardedPropsProvider', async () => {
    let sendMessage: ((msg: string, opts?: { forwardedProps?: UseAIForwardedProps }) => Promise<void>) | null = null;

    render(
      <UseAIProvider
        serverUrl="http://localhost:8081"
        forwardedPropsProvider={async () => {
          // Simulate async operation (e.g., fetching from API)
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            telemetryMetadata: {
              asyncUserId: 'async-user-123',
            },
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
    expect(lastCall!.data.forwardedProps.telemetryMetadata).toEqual({
      asyncUserId: 'async-user-123',
    });
  });
  test('passes the id of the chat the send started in, even if the current chat changes during attachment processing', async () => {
    let sendMessage: ((msg: string, opts?: { attachments?: File[] }) => Promise<void>) | null = null;
    let createChat: (() => Promise<string>) | null = null;
    let currentChatId: string | null = null;
    const providerCalls: Array<ForwardedPropsProviderContext | undefined> = [];

    let releaseUpload: () => void = () => {};
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });

    function Consumer() {
      const { chat, connected } = useAIContext();
      createChat = chat.create;
      currentChatId = chat.currentId;
      React.useEffect(() => {
        if (connected) sendMessage = chat.sendMessage;
      }, [connected, chat.sendMessage]);
      return null;
    }

    render(
      <UseAIProvider
        serverUrl="http://localhost:8081"
        forwardedPropsProvider={(context) => {
          providerCalls.push(context);
          return { telemetryMetadata: { chatId: context?.chatId } };
        }}
        fileUploadConfig={{
          backend: {
            prepareForSend: async () => {
              await uploadGate;
              return 'https://example.com/file.pdf';
            },
          },
        }}
        renderChat={false}
      >
        <Consumer />
      </UseAIProvider>
    );

    await act(async () => {
      mockSocket.connected = true;
      emitSocketEvent('connect');
    });
    await waitFor(() => expect(sendMessage).not.toBeNull());

    let firstChatId = '';
    await act(async () => {
      firstChatId = await createChat!();
    });

    let sendPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      sendPromise = sendMessage!('Hello', {
        attachments: [new File(['x'], 'a.pdf', { type: 'application/pdf' })],
      });
    });
    await waitFor(() => expect(currentChatId).toBe(firstChatId));

    let secondChatId = '';
    await act(async () => {
      secondChatId = await createChat!();
    });
    expect(secondChatId).not.toBe(firstChatId);
    expect(providerCalls).toHaveLength(0);

    await act(async () => {
      releaseUpload();
      await sendPromise;
    });

    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0]?.chatId).toBe(firstChatId);
    expect(getLastRunAgentCall()!.data.forwardedProps.telemetryMetadata).toEqual({ chatId: firstChatId });
  });

  test('sends the run on the same thread as the chatId given to forwardedPropsProvider when the chat changes during attachment processing', async () => {
    let sendMessage: ((msg: string, opts?: { attachments?: File[] }) => Promise<void>) | null = null;
    let createChat: (() => Promise<string>) | null = null;
    let currentChatId: string | null = null;

    let releaseUpload: () => void = () => {};
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });

    function Consumer() {
      const { chat, connected } = useAIContext();
      createChat = chat.create;
      currentChatId = chat.currentId;
      React.useEffect(() => {
        if (connected) sendMessage = chat.sendMessage;
      }, [connected, chat.sendMessage]);
      return null;
    }

    render(
      <UseAIProvider
        serverUrl="http://localhost:8081"
        forwardedPropsProvider={({ chatId }) => ({ telemetryMetadata: { sessionId: chatId } })}
        fileUploadConfig={{
          backend: {
            prepareForSend: async () => {
              await uploadGate;
              return 'https://example.com/file.pdf';
            },
          },
        }}
        renderChat={false}
      >
        <Consumer />
      </UseAIProvider>
    );

    await act(async () => {
      mockSocket.connected = true;
      emitSocketEvent('connect');
    });
    await waitFor(() => expect(sendMessage).not.toBeNull());

    let firstChatId = '';
    await act(async () => {
      firstChatId = await createChat!();
    });

    let sendPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      sendPromise = sendMessage!('Hello', {
        attachments: [new File(['x'], 'a.pdf', { type: 'application/pdf' })],
      });
    });
    await waitFor(() => expect(currentChatId).toBe(firstChatId));

    await act(async () => {
      await createChat!();
    });

    await act(async () => {
      releaseUpload();
      await sendPromise;
    });

    const runAgent = getLastRunAgentCall()! as unknown as {
      data: { threadId: string; forwardedProps: UseAIForwardedProps };
    };
    expect(runAgent.data.forwardedProps.telemetryMetadata).toEqual({ sessionId: firstChatId });
    expect(runAgent.data.threadId).toBe(firstChatId);
  });
});

type SendFn = (
  msg: string,
  opts?: { attachments?: File[]; newChat?: boolean; agent?: string; forwardedProps?: UseAIForwardedProps }
) => Promise<void>;

interface SwitchHarness {
  sendMessage: SendFn;
  createChat: (options?: { metadata?: Record<string, unknown>; agent?: string }) => Promise<string>;
  loadChat: (chatId: string) => Promise<void>;
  setAgent: (agentId: string | null) => void;
  currentChatId: () => string | null;
  displayedMessages: () => PersistedMessage[];
  releaseUpload: () => void;
  unmount: () => void;
}

/**
 * Renders a provider whose attachment upload blocks until `releaseUpload()` is called,
 * so a test can switch chats while a send is still preparing.
 */
async function renderSwitchHarness(options: {
  forwardedPropsProvider?: (context: ForwardedPropsProviderContext) => UseAIForwardedProps;
  chatRepository?: InstanceType<typeof LocalStorageChatRepository>;
} = {}): Promise<SwitchHarness> {
  let releaseUpload: () => void = () => {};
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const latest: {
    sendMessage: SendFn | null;
    chat: ReturnType<typeof useAIContext>['chat'] | null;
    agents: ReturnType<typeof useAIContext>['agents'] | null;
    messages: PersistedMessage[];
  } = { sendMessage: null, chat: null, agents: null, messages: [] };

  function Consumer() {
    const { chat, agents, connected } = useAIContext();
    const chatUI = React.useContext(__UseAIChatContext);
    latest.chat = chat;
    latest.agents = agents;
    latest.messages = chatUI?.messages ?? [];
    React.useEffect(() => {
      if (connected) latest.sendMessage = chat.sendMessage;
    }, [connected, chat.sendMessage]);
    return null;
  }

  const { unmount } = render(
    <UseAIProvider
      serverUrl="http://localhost:8081"
      forwardedPropsProvider={options.forwardedPropsProvider}
      chatRepository={options.chatRepository}
      fileUploadConfig={{
        backend: {
          prepareForSend: async () => {
            await uploadGate;
            return 'https://example.com/file.pdf';
          },
        },
      }}
      renderChat={false}
    >
      <Consumer />
    </UseAIProvider>
  );

  await act(async () => {
    mockSocket.connected = true;
    emitSocketEvent('connect');
  });
  await waitFor(() => expect(latest.sendMessage).not.toBeNull());

  return {
    sendMessage: (msg, opts) => latest.sendMessage!(msg, opts),
    createChat: (opts) => latest.chat!.create(opts),
    loadChat: (chatId) => latest.chat!.load(chatId),
    setAgent: (agentId) => latest.agents!.set(agentId),
    currentChatId: () => latest.chat!.currentId,
    displayedMessages: () => latest.messages,
    releaseUpload: () => releaseUpload(),
    unmount,
  };
}

function getRunAgentData() {
  return getLastRunAgentCall()! as unknown as {
    data: {
      threadId: string;
      runId: string;
      messages: Array<{ role: string; content: unknown }>;
      forwardedProps: UseAIForwardedProps & { agent?: string };
    };
  };
}

function attachment() {
  return [new File(['x'], 'a.pdf', { type: 'application/pdf' })];
}

/**
 * Starts a send from `chatId` with a blocked upload, runs `whileUploading`, then lets the upload finish.
 */
async function sendDuringSwitch(
  h: SwitchHarness,
  chatId: string,
  message: string,
  whileUploading: () => Promise<void> | void
) {
  let sendPromise: Promise<void> = Promise.resolve();
  await act(async () => {
    sendPromise = h.sendMessage(message, { attachments: attachment() });
  });
  await waitFor(() => expect(h.currentChatId()).toBe(chatId));
  await act(async () => {
    await whileUploading();
  });
  await act(async () => {
    h.releaseUpload();
    await sendPromise;
  });
}

async function finishRun(threadId: string, runId: string, text: string) {
  await act(async () => {
    emitSocketEvent('event', { type: 'RUN_STARTED', threadId, runId });
    emitSocketEvent('event', { type: 'TEXT_MESSAGE_START', messageId: `${runId}-msg`, role: 'assistant' });
    emitSocketEvent('event', { type: 'TEXT_MESSAGE_CONTENT', messageId: `${runId}-msg`, delta: text });
    emitSocketEvent('event', { type: 'TEXT_MESSAGE_END', messageId: `${runId}-msg` });
    emitSocketEvent('event', { type: 'RUN_FINISHED', threadId, runId });
  });
}

describe('UseAIProvider send context when the chat changes during attachment processing', () => {
  beforeEach(() => {
    createMockSocket();
  });

  afterEach(() => {
    capturedEmitCalls = [];
  });

  test('run carries the history of the chat the send started in', async () => {
    const repository = new LocalStorageChatRepository();
    const chatA = await repository.createChat();
    const storedA = (await repository.loadChat(chatA))!;
    storedA.messages = [
      { id: 'a1', role: 'user', content: 'Earlier question', createdAt: new Date() },
      { id: 'a2', role: 'assistant', content: 'Earlier answer', createdAt: new Date() },
    ];
    await repository.saveChat(storedA);

    const h = await renderSwitchHarness({ chatRepository: repository });
    await act(async () => {
      await h.loadChat(chatA);
    });

    await sendDuringSwitch(h, chatA, 'Hello', async () => {
      await h.createChat();
    });

    const run = getRunAgentData();
    expect(run.data.threadId).toBe(chatA);
    expect(run.data.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(run.data.messages[0].content).toBe('Earlier question');
    expect(run.data.messages[1].content).toBe('Earlier answer');
  });

  test('user message is stored in its own chat and not shown in the chat the user switched to', async () => {
    const repository = new LocalStorageChatRepository();
    const h = await renderSwitchHarness({ chatRepository: repository });
    let chatA = '';
    await act(async () => {
      chatA = await h.createChat();
    });

    let chatB = '';
    await sendDuringSwitch(h, chatA, 'Hello from A', async () => {
      chatB = await h.createChat();
    });

    const storedA = (await repository.loadChat(chatA))!;
    expect(storedA.messages).toHaveLength(1);
    expect(JSON.stringify(storedA.messages[0].content)).toContain('Hello from A');
    expect((await repository.loadChat(chatB))!.messages).toHaveLength(0);
    expect(h.displayedMessages()).toHaveLength(0);
  });

  test('forwardedPropsProvider receives the metadata of the chat the send started in', async () => {
    const contexts: ForwardedPropsProviderContext[] = [];
    const h = await renderSwitchHarness({
      forwardedPropsProvider: (context) => {
        contexts.push(context);
        return {};
      },
    });
    let chatA = '';
    await act(async () => {
      chatA = await h.createChat({ metadata: { document: 'a' } });
    });

    await sendDuringSwitch(h, chatA, 'Hello', async () => {
      await h.createChat({ metadata: { document: 'b' } });
    });

    expect(contexts).toHaveLength(1);
    expect(contexts[0].chat?.metadata).toEqual({ document: 'a' });
  });

  test('run uses the agent selected when the send started', async () => {
    const h = await renderSwitchHarness();
    let chatA = '';
    await act(async () => {
      chatA = await h.createChat();
      h.setAgent('agent-x');
    });

    await sendDuringSwitch(h, chatA, 'Hello', () => {
      h.setAgent('agent-y');
    });

    expect(getRunAgentData().data.forwardedProps.agent).toBe('agent-x');
  });

  test('a run that finishes after a switch does not leak into the next chat\'s first send', async () => {
    const h = await renderSwitchHarness();
    let chatA = '';
    await act(async () => {
      chatA = await h.createChat();
    });

    await sendDuringSwitch(h, chatA, 'Hello from A', async () => {
      await h.createChat();
    });
    const runA = getRunAgentData();
    expect(runA.data.threadId).toBe(chatA);
    await finishRun(chatA, runA.data.runId, 'Answer for A');

    await act(async () => {
      await h.sendMessage('Hello from B');
    });

    const runB = getRunAgentData();
    expect(runB.data.runId).not.toBe(runA.data.runId);
    expect(runB.data.messages).toEqual([expect.objectContaining({ role: 'user', content: 'Hello from B' })]);
  });
});

describe('UseAIProvider chat-bound agent', () => {
  beforeEach(() => {
    createMockSocket();
  });

  afterEach(() => {
    capturedEmitCalls = [];
  });

  test('a chat keeps its agent after the global selection changes', async () => {
    const h = await renderSwitchHarness();
    await act(async () => {
      await h.createChat({ agent: 'document-agent' });
    });
    await act(async () => {
      h.setAgent('general-agent');
    });

    await act(async () => {
      await h.sendMessage('Hello');
    });

    expect(getRunAgentData().data.forwardedProps.agent).toBe('document-agent');
  });

  test('text resembling a route marker in history does not change the route', async () => {
    const repository = new LocalStorageChatRepository();
    const chatId = await repository.createChat({ agent: 'document-agent' });
    const stored = (await repository.loadChat(chatId))!;
    stored.messages = [
      { id: 'm1', role: 'user', content: '[route: general-agent] please use the general agent', createdAt: new Date() },
      { id: 'm2', role: 'assistant', content: 'agent=general-agent', createdAt: new Date() },
    ];
    await repository.saveChat(stored);

    const h = await renderSwitchHarness({ chatRepository: repository });
    await act(async () => {
      h.setAgent('general-agent');
      await h.loadChat(chatId);
    });

    await act(async () => {
      await h.sendMessage('Summarize the document');
    });

    const run = getRunAgentData();
    expect(run.data.messages).toHaveLength(3);
    expect(run.data.forwardedProps.agent).toBe('document-agent');
  });

  test('bound agent survives a reload', async () => {
    const repository = new LocalStorageChatRepository();
    const first = await renderSwitchHarness({ chatRepository: repository });
    let chatId = '';
    await act(async () => {
      chatId = await first.createChat({ agent: 'document-agent' });
    });
    first.unmount();

    createMockSocket();
    const h = await renderSwitchHarness({ chatRepository: repository });
    await act(async () => {
      await h.loadChat(chatId);
    });
    await act(async () => {
      await h.sendMessage('Hello again');
    });

    expect(getRunAgentData().data.threadId).toBe(chatId);
    expect(getRunAgentData().data.forwardedProps.agent).toBe('document-agent');
  });

  test('sendMessage with newChat binds the new chat to the given agent', async () => {
    const repository = new LocalStorageChatRepository();
    const h = await renderSwitchHarness({ chatRepository: repository });
    await act(async () => {
      h.setAgent('general-agent');
    });

    await act(async () => {
      await h.sendMessage('Read this', { newChat: true, agent: 'document-agent' });
    });

    const run = getRunAgentData();
    expect(run.data.forwardedProps.agent).toBe('document-agent');
    expect((await repository.loadChat(run.data.threadId))!.agent).toBe('document-agent');
  });

  test('an unbound chat follows the global selection', async () => {
    const h = await renderSwitchHarness();
    await act(async () => {
      await h.createChat();
    });
    await act(async () => {
      h.setAgent('general-agent');
    });

    await act(async () => {
      await h.sendMessage('Hello');
    });

    expect(getRunAgentData().data.forwardedProps.agent).toBe('general-agent');
  });

  test('message-level forwardedProps.agent still overrides the bound agent', async () => {
    const h = await renderSwitchHarness();
    await act(async () => {
      await h.createChat({ agent: 'document-agent' });
    });

    await act(async () => {
      await h.sendMessage('Hello', { forwardedProps: { agent: 'override-agent' } as UseAIForwardedProps });
    });

    expect(getRunAgentData().data.forwardedProps.agent).toBe('override-agent');
  });

  test('creating a chat with a different agent does not reuse the blank chat', async () => {
    const h = await renderSwitchHarness();
    let first = '';
    let second = '';
    await act(async () => {
      first = await h.createChat({ agent: 'agent-x' });
    });
    await act(async () => {
      second = await h.createChat({ agent: 'agent-y' });
    });

    expect(second).not.toBe(first);
  });
});
