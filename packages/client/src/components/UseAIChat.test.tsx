import React from 'react';
import { describe, test, expect, mock } from 'bun:test';
import { render, fireEvent } from '@testing-library/react';
import { UseAIChat, __UseAIChatContext, type ChatUIContextValue } from './UseAIChat';
import type { PersistedMessage } from '../providers/chatRepository/types';
import { StringsContext, defaultStrings } from '../theme';

function createContextValue(overrides: Partial<ChatUIContextValue> = {}): ChatUIContextValue {
  return {
    connected: true,
    loading: false,
    sendMessage: mock(async () => {}),
    messages: [],
    streamingParts: [],
    streamingMessageId: null,
    suggestions: [],
    fileUploadConfig: undefined,
    history: {
      currentId: 'chat-1',
      create: async () => 'chat-1',
      load: async () => {},
      delete: async () => {},
      list: async () => [],
      get: async () => null,
    },
    agents: {
      available: [],
      default: null,
      selected: null,
      set: mock(() => {}),
    },
    commands: {
      list: [],
      save: async () => 'cmd-1',
      rename: async () => {},
      delete: async () => {},
    },
    fileProcessing: null,
    ui: {
      isOpen: true,
      setOpen: mock(() => {}),
    },
    tools: {
      executing: null,
      pending: {
        tools: [],
        approveAll: mock(() => {}),
        rejectAll: mock(() => {}),
      },
    },
    feedback: {
      enabled: false,
      submit: mock(() => {}),
    },
    ...overrides,
  };
}

describe('UseAIChat', () => {
  test('prefers instance component overrides over provider-level overrides', () => {
    const ProviderHeader = () => <div data-testid="provider-header" />;
    const InstanceHeader = () => <div data-testid="instance-header" />;
    const ctx = createContextValue({ components: { Header: ProviderHeader } });

    const { getByTestId, queryByTestId } = render(
      <__UseAIChatContext.Provider value={ctx}>
        <UseAIChat components={{ Header: InstanceHeader }} />
      </__UseAIChatContext.Provider>
    );

    expect(getByTestId('instance-header')).toBeInTheDocument();
    expect(queryByTestId('provider-header')).toBeNull();
  });

  test('passes the streaming parts through to UseAIChatPanel', () => {
    const ctx = createContextValue({
      loading: true,
      streamingParts: [{ kind: 'reasoning', text: 'First thought...' }],
    });

    const { getByTestId, getByText } = render(
      <__UseAIChatContext.Provider value={ctx}>
        <UseAIChat />
      </__UseAIChatContext.Provider>
    );

    expect(getByTestId('thinking-toggle')).toBeInTheDocument();
    expect(getByText('Thinking...')).toBeInTheDocument();
  });

  // Without the id the streaming bubble and the persisted one are different
  // elements, and a selection made while the answer streams is lost on
  // completion. See UseAIChatPanel.selection.test.tsx.
  test('renders the streaming answer under the id it will be persisted with', () => {
    const ctx = createContextValue({
      loading: true,
      streamingParts: [{ kind: 'text', text: 'partial answer' }],
      streamingMessageId: 'msg-assistant',
    });

    const { container, rerender } = render(
      <__UseAIChatContext.Provider value={ctx}>
        <UseAIChat />
      </__UseAIChatContext.Provider>
    );

    const streamingBubble = container.querySelector('[data-testid="chat-message-assistant-streaming"]');
    expect(streamingBubble).not.toBeNull();

    const persisted: PersistedMessage = {
      id: 'msg-assistant',
      role: 'assistant',
      content: 'partial answer, completed',
      createdAt: new Date(0),
    };
    rerender(
      <__UseAIChatContext.Provider
        value={createContextValue({ messages: [persisted], streamingParts: [], streamingMessageId: null })}
      >
        <UseAIChat />
      </__UseAIChatContext.Provider>
    );

    expect(container.querySelector('[data-testid="chat-message-assistant"]')).toBe(streamingBubble);
  });

  describe('save command feature toggle', () => {
    const userMessage: PersistedMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'hello world',
      createdAt: new Date(0),
    };

    test('shows save command button on hover when commands.save is provided', () => {
      const ctx = createContextValue({ messages: [userMessage] });

      const { container, queryByTestId } = render(
        <__UseAIChatContext.Provider value={ctx}>
          <UseAIChat />
        </__UseAIChatContext.Provider>
      );

      const bubble = container.querySelector('.chat-message-user');
      expect(bubble).not.toBeNull();
      fireEvent.mouseEnter(bubble!);

      expect(queryByTestId('save-command-button')).toBeInTheDocument();
    });

    test('hides save command button when slashCommands feature is disabled', () => {
      const ctx = createContextValue({
        messages: [userMessage],
        enabledFeatures: { slashCommands: false },
      });

      const { container, queryByTestId } = render(
        <__UseAIChatContext.Provider value={ctx}>
          <UseAIChat />
        </__UseAIChatContext.Provider>
      );

      const bubble = container.querySelector('.chat-message-user');
      expect(bubble).not.toBeNull();
      fireEvent.mouseEnter(bubble!);

      expect(queryByTestId('save-command-button')).toBeNull();
      expect(queryByTestId('inline-save-command')).toBeNull();
    });
  });

  describe('input disclaimer', () => {
    const userMessage: PersistedMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'hello world',
      createdAt: new Date(0),
    };

    test('stays hidden when the inputDisclaimer feature is not enabled', () => {
      const ctx = createContextValue({ messages: [userMessage] });

      const { queryByTestId } = render(
        <__UseAIChatContext.Provider value={ctx}>
          <UseAIChat />
        </__UseAIChatContext.Provider>
      );

      expect(queryByTestId('chat-input-disclaimer')).toBeNull();
    });

    test('stays hidden while the chat is empty', () => {
      const ctx = createContextValue({ enabledFeatures: { inputDisclaimer: true } });

      const { queryByTestId } = render(
        <__UseAIChatContext.Provider value={ctx}>
          <UseAIChat />
        </__UseAIChatContext.Provider>
      );

      expect(queryByTestId('chat-input-disclaimer')).toBeNull();
    });

    test('appears once the conversation has started', () => {
      const ctx = createContextValue({
        messages: [userMessage],
        enabledFeatures: { inputDisclaimer: true },
      });

      const { getByTestId } = render(
        <__UseAIChatContext.Provider value={ctx}>
          <UseAIChat />
        </__UseAIChatContext.Provider>
      );

      expect(getByTestId('chat-input-disclaimer')).toHaveTextContent(
        defaultStrings.input.disclaimer
      );
    });

    test('uses the overridden text from strings', () => {
      const ctx = createContextValue({
        messages: [userMessage],
        enabledFeatures: { inputDisclaimer: true },
      });
      const strings = {
        ...defaultStrings,
        input: { ...defaultStrings.input, disclaimer: 'Custom disclaimer' },
      };

      const { getByTestId } = render(
        <StringsContext.Provider value={strings}>
          <__UseAIChatContext.Provider value={ctx}>
            <UseAIChat />
          </__UseAIChatContext.Provider>
        </StringsContext.Provider>
      );

      expect(getByTestId('chat-input-disclaimer')).toHaveTextContent('Custom disclaimer');
    });
  });
});
