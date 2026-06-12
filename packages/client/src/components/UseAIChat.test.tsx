import React from 'react';
import { describe, test, expect, mock } from 'bun:test';
import { render, fireEvent } from '@testing-library/react';
import { UseAIChat, __UseAIChatContext, type ChatUIContextValue } from './UseAIChat';
import type { PersistedMessage } from '../providers/chatRepository/types';

function createContextValue(overrides: Partial<ChatUIContextValue> = {}): ChatUIContextValue {
  return {
    connected: true,
    loading: false,
    sendMessage: mock(async () => {}),
    messages: [],
    streamingText: '',
    streamingReasoning: '',
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
  test('passes streaming reasoning through to UseAIChatPanel', () => {
    const ctx = createContextValue({
      loading: true,
      streamingReasoning: 'First thought...',
    });

    const { getByTestId, getByText } = render(
      <__UseAIChatContext.Provider value={ctx}>
        <UseAIChat />
      </__UseAIChatContext.Provider>
    );

    expect(getByTestId('thinking-toggle')).toBeInTheDocument();
    expect(getByText('Thinking...')).toBeInTheDocument();
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

    test('hides save command button when enableSaveCommand is false', () => {
      const ctx = createContextValue({
        messages: [userMessage],
        enableSaveCommand: false,
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
});
