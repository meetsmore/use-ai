import React from 'react';
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { render, act, waitFor } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import type { UseAIForwardedProps } from '../types';
import { z } from 'zod';
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
const { UseAIChat, __UseAIChatContext } = await import('../components/UseAIChat');
const { LocalStorageChatRepository } = await import('./chatRepository/LocalStorageChatRepository');
const { useAI } = await import('../useAI');
const { defineTool } = await import('../defineTool');

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
  opts?: { attachments?: File[]; newChat?: boolean; agent?: string; forwardedProps?: UseAIForwardedProps; hiddenText?: string }
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

describe('UseAIProvider sendMessage hiddenText', () => {
  beforeEach(() => {
    createMockSocket();
  });

  afterEach(() => {
    capturedEmitCalls = [];
  });

  test('is sent before the visible text, stored with the message and kept out of the title', async () => {
    const repository = new LocalStorageChatRepository();
    const h = await renderSwitchHarness({ chatRepository: repository });
    let chatId = '';
    await act(async () => {
      chatId = await h.createChat();
    });
    await act(async () => {
      await h.sendMessage('Question', { hiddenText: 'Context' });
    });

    expect(getRunAgentData().data.messages.at(-1)!.content).toEqual([
      { type: 'text', text: 'Context' },
      { type: 'text', text: 'Question' },
    ]);
    const stored = (await repository.loadChat(chatId))!;
    expect(stored.messages[0].content).toEqual([
      { type: 'hidden_text', text: 'Context' },
      { type: 'text', text: 'Question' },
    ]);
    expect(stored.title).toBe('Question');
  });

  test('comes before the attachments too', async () => {
    const h = await renderSwitchHarness();
    await act(async () => {
      await h.createChat();
    });
    let sendPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      sendPromise = h.sendMessage('Question', { hiddenText: 'Context', attachments: attachment() });
    });
    await act(async () => {
      h.releaseUpload();
      await sendPromise;
    });

    const content = getRunAgentData().data.messages.at(-1)!.content as Array<{ type: string }>;
    expect(content.map((part) => part.type)).toEqual(['text', 'text', 'file_url']);
    expect(content.slice(0, 2)).toEqual([
      { type: 'text', text: 'Context' },
      { type: 'text', text: 'Question' },
    ]);
  });

  test('reaches the AI again on later turns after a reload', async () => {
    const repository = new LocalStorageChatRepository();
    const first = await renderSwitchHarness({ chatRepository: repository });
    let chatId = '';
    await act(async () => {
      chatId = await first.createChat();
    });
    await act(async () => {
      await first.sendMessage('Question', { hiddenText: 'Context' });
    });
    first.unmount();

    createMockSocket();
    const h = await renderSwitchHarness({ chatRepository: repository });
    await act(async () => {
      await h.loadChat(chatId);
    });
    await act(async () => {
      await h.sendMessage('Follow-up');
    });

    expect(getRunAgentData().data.messages[0].content).toEqual([
      { type: 'text', text: 'Context' },
      { type: 'text', text: 'Question' },
    ]);
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

  test('a bound chat with history keeps its agent after the global selection changes', async () => {
    const repository = new LocalStorageChatRepository();
    const chatId = await repository.createChat({ agent: 'document-agent' });
    const stored = (await repository.loadChat(chatId))!;
    stored.messages = [
      { id: 'm1', role: 'user', content: 'Here is the document', createdAt: new Date() },
      { id: 'm2', role: 'assistant', content: 'Got it', createdAt: new Date() },
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

describe('UseAIProvider run in flight when the chat changes', () => {
  beforeEach(() => {
    createMockSocket();
  });

  afterEach(() => {
    capturedEmitCalls = [];
  });

  async function renderWithTool(repository: InstanceType<typeof LocalStorageChatRepository>) {
    const toolCalls: Array<{ note: string }> = [];
    const latest: {
      sendMessage: SendFn | null;
      chat: ReturnType<typeof useAIContext>['chat'] | null;
      messages: PersistedMessage[];
    } = { sendMessage: null, chat: null, messages: [] };

    function Consumer() {
      const { chat, connected } = useAIContext();
      const chatUI = React.useContext(__UseAIChatContext);
      latest.chat = chat;
      latest.messages = chatUI?.messages ?? [];
      useAI({
        prompt: 'Recorder',
        tools: {
          recordRun: defineTool('Record a run', z.object({ note: z.string() }), (input) => {
            toolCalls.push(input);
            return { recorded: true };
          }),
        },
      });
      React.useEffect(() => {
        if (connected) latest.sendMessage = chat.sendMessage;
      }, [connected, chat.sendMessage]);
      return null;
    }

    render(
      <UseAIProvider serverUrl="http://localhost:8081" chatRepository={repository} renderChat={false}>
        <Consumer />
      </UseAIProvider>
    );
    await act(async () => {
      mockSocket.connected = true;
      emitSocketEvent('connect');
    });
    await waitFor(() => expect(latest.sendMessage).not.toBeNull());
    return { latest, toolCalls };
  }

  function toolResultCalls() {
    return capturedEmitCalls.filter(
      (call) => call.event === 'message' && (call.data as { type: string }).type === 'tool_result'
    ) as Array<{ data: { data: { toolCallId: string; content: string } } }>;
  }

  test('a tool call survives a chat switch between TOOL_CALL_START and TOOL_CALL_END, and its turn stays in its own chat', async () => {
    const repository = new LocalStorageChatRepository();
    const { latest, toolCalls } = await renderWithTool(repository);

    let chatA = '';
    await act(async () => {
      chatA = await latest.chat!.create();
    });
    await act(async () => {
      await latest.sendMessage!('Run the tool');
    });
    const runA = getRunAgentData() as unknown as {
      data: { threadId: string; runId: string; tools: Array<{ name: string }> };
    };
    expect(runA.data.threadId).toBe(chatA);
    const toolName = runA.data.tools.find((t) => t.name.endsWith('recordRun'))!.name;

    await act(async () => {
      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: chatA, runId: runA.data.runId });
      emitSocketEvent('event', { type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: toolName });
      emitSocketEvent('event', { type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '{"note":"from A"}' });
    });

    let chatB = '';
    await act(async () => {
      chatB = await latest.chat!.create();
    });
    expect(chatB).not.toBe(chatA);

    await act(async () => {
      emitSocketEvent('event', { type: 'TOOL_CALL_END', toolCallId: 't1' });
    });
    await waitFor(() => expect(toolResultCalls()).toHaveLength(1));
    expect(toolCalls).toEqual([{ note: 'from A' }]);
    expect(toolResultCalls()[0].data.data.toolCallId).toBe('t1');

    await act(async () => {
      emitSocketEvent('event', { type: 'STEP_FINISHED', stepName: 'step-1' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_START', messageId: 'm-final', role: 'assistant' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm-final', delta: 'Recorded for A' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_END', messageId: 'm-final' });
      emitSocketEvent('event', { type: 'RUN_FINISHED', threadId: chatA, runId: runA.data.runId });
    });

    await waitFor(async () => {
      const storedA = (await repository.loadChat(chatA))!;
      expect(storedA.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    });
    const storedA = (await repository.loadChat(chatA))!;
    expect(storedA.messages[3].content).toBe('Recorded for A');
    expect((await repository.loadChat(chatB))!.messages).toHaveLength(0);
    expect(latest.messages).toHaveLength(0);

    await act(async () => {
      await latest.sendMessage!('Hello from B');
    });
    const runB = getRunAgentData();
    expect(runB.data.threadId).toBe(chatB);
    expect(runB.data.messages).toEqual([expect.objectContaining({ role: 'user', content: 'Hello from B' })]);
  });

  test('a run aborted after a chat switch still records its unanswered tool calls in its own chat', async () => {
    const repository = new LocalStorageChatRepository();
    const { latest } = await renderWithTool(repository);

    let chatA = '';
    await act(async () => {
      chatA = await latest.chat!.create();
    });
    await act(async () => {
      await latest.sendMessage!('Run a server tool');
    });
    const runA = getRunAgentData();

    await act(async () => {
      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: chatA, runId: runA.data.runId });
      emitSocketEvent('event', { type: 'TOOL_CALL_START', toolCallId: 't-server', toolCallName: 'notAClientTool' });
      emitSocketEvent('event', { type: 'TOOL_CALL_ARGS', toolCallId: 't-server', delta: '{}' });
      emitSocketEvent('event', { type: 'TOOL_CALL_END', toolCallId: 't-server' });
    });

    let chatB = '';
    await act(async () => {
      chatB = await latest.chat!.create();
    });

    await act(async () => {
      emitSocketEvent('event', { type: 'RUN_ERROR', message: 'ABORTED' });
    });

    await waitFor(async () => {
      const storedA = (await repository.loadChat(chatA))!;
      expect(storedA.messages.map((m) => m.role)).toContain('tool');
    });
    const storedA = (await repository.loadChat(chatA))!;
    const toolResult = storedA.messages.find((m) => m.role === 'tool')!;
    expect(JSON.stringify(toolResult.content)).toContain('aborted');
    expect((await repository.loadChat(chatB))!.messages).toHaveLength(0);
  });
});

describe('UseAIProvider metadata written by a file transformer', () => {
  beforeEach(() => {
    createMockSocket();
  });

  afterEach(() => {
    capturedEmitCalls = [];
  });

  /**
   * Renders a provider whose PDF transformer blocks until `releaseUpload()` is called, then
   * writes `{ documentId }` to the chat in its context with `chat.updateMetadata`.
   */
  async function renderWithMetadataTransformer(repository: InstanceType<typeof LocalStorageChatRepository>) {
    let releaseUpload: () => void = () => {};
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const contexts: ForwardedPropsProviderContext[] = [];
    const transformerChatIds: Array<string | undefined> = [];
    const latest: { chat: ReturnType<typeof useAIContext>['chat'] | null; sendMessage: SendFn | null } = {
      chat: null,
      sendMessage: null,
    };

    function Consumer() {
      const { chat, connected } = useAIContext();
      latest.chat = chat;
      React.useEffect(() => {
        if (connected) latest.sendMessage = chat.sendMessage;
      }, [connected, chat.sendMessage]);
      return null;
    }

    render(
      <UseAIProvider
        serverUrl="http://localhost:8081"
        chatRepository={repository}
        renderChat={false}
        forwardedPropsProvider={(context) => {
          contexts.push(context);
          return {};
        }}
        fileUploadConfig={{
          transformers: {
            'application/pdf': {
              transform: async (files, context) => {
                transformerChatIds.push(context.chat?.id);
                await uploadGate;
                await latest.chat!.updateMetadata({ documentId: 'doc-1' }, false, context.chat?.id);
                return files.map(() => 'TRANSFORMED');
              },
            },
          },
        }}
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
      contexts,
      transformerChatIds,
      createChat: () => latest.chat!.create(),
      sendMessage: (msg: string) => latest.sendMessage!(msg, { attachments: attachment() }),
      releaseUpload: () => releaseUpload(),
    };
  }

  test('lands on the chat the file is sent from after a switch', async () => {
    const repository = new LocalStorageChatRepository();
    const h = await renderWithMetadataTransformer(repository);
    let chatA = '';
    await act(async () => {
      chatA = await h.createChat();
    });

    let sendPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      sendPromise = h.sendMessage('Read this');
    });
    await waitFor(() => expect(h.transformerChatIds).toEqual([chatA]));
    let chatB = '';
    await act(async () => {
      chatB = await h.createChat();
    });
    await act(async () => {
      h.releaseUpload();
      await sendPromise;
    });

    expect((await repository.loadChat(chatA))!.metadata).toEqual({ documentId: 'doc-1' });
    expect((await repository.loadChat(chatB))!.metadata ?? {}).toEqual({});
    expect(h.contexts[0].chatId).toBe(chatA);
    expect(h.contexts[0].chat?.metadata).toEqual({ documentId: 'doc-1' });
    expect(getRunAgentData().data.threadId).toBe(chatA);
  });

  test('is seen by forwardedPropsProvider in the same send', async () => {
    const repository = new LocalStorageChatRepository();
    const h = await renderWithMetadataTransformer(repository);
    await act(async () => {
      await h.createChat();
    });

    await act(async () => {
      const sendPromise = h.sendMessage('Read this');
      h.releaseUpload();
      await sendPromise;
    });

    expect(h.contexts).toHaveLength(1);
    expect(h.contexts[0].chat?.metadata).toEqual({ documentId: 'doc-1' });
  });
});

describe('UseAIProvider file processing indicator', () => {
  beforeEach(() => {
    createMockSocket();
  });

  afterEach(() => {
    capturedEmitCalls = [];
  });

  test('shows only in the chat the file is sent from', async () => {
    let releaseUpload: () => void = () => {};
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const latest: {
      chat: ReturnType<typeof useAIContext>['chat'] | null;
      sendMessage: SendFn | null;
      fileProcessing: unknown;
    } = { chat: null, sendMessage: null, fileProcessing: null };

    function Consumer() {
      const { chat, connected } = useAIContext();
      const chatUI = React.useContext(__UseAIChatContext);
      latest.chat = chat;
      latest.fileProcessing = chatUI?.fileProcessing ?? null;
      React.useEffect(() => {
        if (connected) latest.sendMessage = chat.sendMessage;
      }, [connected, chat.sendMessage]);
      return null;
    }

    render(
      <UseAIProvider
        serverUrl="http://localhost:8081"
        chatRepository={new LocalStorageChatRepository()}
        renderChat={false}
        fileUploadConfig={{
          transformers: {
            'application/pdf': {
              transform: async (files, _context, onProgress) => {
                onProgress?.(40);
                await uploadGate;
                return files.map(() => 'TRANSFORMED');
              },
            },
          },
        }}
      >
        <Consumer />
      </UseAIProvider>
    );
    await act(async () => {
      mockSocket.connected = true;
      emitSocketEvent('connect');
    });
    await waitFor(() => expect(latest.sendMessage).not.toBeNull());

    let chatA = '';
    await act(async () => {
      chatA = await latest.chat!.create();
    });
    let sendPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      sendPromise = latest.sendMessage!('Read this', { attachments: attachment() });
    });
    await waitFor(() => expect(latest.fileProcessing).toEqual({ status: 'processing', progress: 40 }));

    await act(async () => {
      await latest.chat!.create();
    });
    expect(latest.fileProcessing).toBeNull();

    await act(async () => {
      await latest.chat!.load(chatA);
    });
    expect(latest.fileProcessing).toEqual({ status: 'processing', progress: 40 });

    await act(async () => {
      releaseUpload();
      await sendPromise;
    });
  });
});

describe('UseAIProvider pending indicator', () => {
  beforeEach(() => {
    createMockSocket();
  });

  afterEach(() => {
    capturedEmitCalls = [];
  });

  test('shows the pending bubble and "Thinking..." only in the chat the run belongs to', async () => {
    const latest: { chat: ReturnType<typeof useAIContext>['chat'] | null; sendMessage: SendFn | null } = {
      chat: null,
      sendMessage: null,
    };

    function Consumer() {
      const { chat, connected } = useAIContext();
      latest.chat = chat;
      React.useEffect(() => {
        if (connected) latest.sendMessage = chat.sendMessage;
      }, [connected, chat.sendMessage]);
      return null;
    }

    const { container, getByTestId } = render(
      <UseAIProvider
        serverUrl="http://localhost:8081"
        chatRepository={new LocalStorageChatRepository()}
        renderChat={false}
      >
        <Consumer />
        <UseAIChat />
      </UseAIProvider>
    );
    await act(async () => {
      mockSocket.connected = true;
      emitSocketEvent('connect');
    });
    await waitFor(() => expect(latest.sendMessage).not.toBeNull());

    let chatA = '';
    await act(async () => {
      chatA = await latest.chat!.create();
    });
    await act(async () => {
      await latest.sendMessage!('Hello');
    });
    const pendingBubble = () => container.querySelector('.dots') !== null;
    const placeholder = () => getByTestId('chat-input').getAttribute('placeholder');
    await waitFor(() => expect(pendingBubble()).toBe(true));
    expect(placeholder()).toBe('Thinking...');

    await act(async () => {
      await latest.chat!.create();
    });
    expect(pendingBubble()).toBe(false);
    expect(placeholder()).not.toBe('Thinking...');

    await act(async () => {
      await latest.chat!.load(chatA);
    });
    expect(pendingBubble()).toBe(true);
    expect(placeholder()).toBe('Thinking...');
  });
});

describe('UseAIProvider thinking and streamed answer', () => {
  beforeEach(() => {
    createMockSocket();
  });

  afterEach(() => {
    capturedEmitCalls = [];
  });

  test('show only in the chat the run belongs to, while it streams and once it is saved', async () => {
    const repository = new LocalStorageChatRepository();
    const latest: { chat: ReturnType<typeof useAIContext>['chat'] | null; sendMessage: SendFn | null } = {
      chat: null,
      sendMessage: null,
    };

    function Consumer() {
      const { chat, connected } = useAIContext();
      latest.chat = chat;
      React.useEffect(() => {
        if (connected) latest.sendMessage = chat.sendMessage;
      }, [connected, chat.sendMessage]);
      return null;
    }

    const { container, queryAllByTestId } = render(
      <UseAIProvider serverUrl="http://localhost:8081" chatRepository={repository} renderChat={false}>
        <Consumer />
        <UseAIChat />
      </UseAIProvider>
    );
    await act(async () => {
      mockSocket.connected = true;
      emitSocketEvent('connect');
    });
    await waitFor(() => expect(latest.sendMessage).not.toBeNull());

    let chatA = '';
    await act(async () => {
      chatA = await latest.chat!.create();
    });
    await act(async () => {
      await latest.sendMessage!('Count to three');
    });
    const runA = getRunAgentData();
    expect(runA.data.threadId).toBe(chatA);

    const thinkingBlocks = () => queryAllByTestId('thinking-timeline').length;
    const shows = (text: string) => container.textContent?.includes(text) ?? false;

    await act(async () => {
      emitSocketEvent('event', { type: 'RUN_STARTED', threadId: chatA, runId: runA.data.runId });
      emitSocketEvent('event', { type: 'REASONING_MESSAGE_START', messageId: 'r1', role: 'assistant' });
      emitSocketEvent('event', { type: 'REASONING_MESSAGE_CONTENT', messageId: 'r1', delta: 'Counting for A' });
    });
    await waitFor(() => expect(thinkingBlocks()).toBe(1));

    let chatB = '';
    await act(async () => {
      chatB = await latest.chat!.create();
    });
    expect(chatB).not.toBe(chatA);
    expect(thinkingBlocks()).toBe(0);

    // Chat A's run keeps streaming while chat B is displayed.
    await act(async () => {
      emitSocketEvent('event', { type: 'REASONING_MESSAGE_CONTENT', messageId: 'r1', delta: ' up to three' });
      emitSocketEvent('event', { type: 'REASONING_MESSAGE_END', messageId: 'r1' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' });
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: '1 2 3 ALPHA' });
    });
    expect(thinkingBlocks()).toBe(0);
    expect(shows('1 2 3 ALPHA')).toBe(false);

    await act(async () => {
      emitSocketEvent('event', { type: 'TEXT_MESSAGE_END', messageId: 'm1' });
      emitSocketEvent('event', { type: 'RUN_FINISHED', threadId: chatA, runId: runA.data.runId });
    });
    await waitFor(async () => {
      const storedA = (await repository.loadChat(chatA))!;
      expect(storedA.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    });
    const storedA = (await repository.loadChat(chatA))!;
    expect(storedA.messages[1].reasoningParts?.map((p) => p.text).join('')).toBe('Counting for A up to three');
    expect((await repository.loadChat(chatB))!.messages).toHaveLength(0);
    expect(thinkingBlocks()).toBe(0);
    expect(shows('1 2 3 ALPHA')).toBe(false);

    await act(async () => {
      await latest.chat!.load(chatA);
    });
    await waitFor(() => expect(shows('1 2 3 ALPHA')).toBe(true));
    expect(thinkingBlocks()).toBe(1);
  });
});
