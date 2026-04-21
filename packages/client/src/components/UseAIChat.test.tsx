import React from 'react';
import { describe, test, expect, mock } from 'bun:test';
import { render } from '@testing-library/react';
import { UseAIChat, __UseAIChatContext, type ChatUIContextValue } from './UseAIChat';

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
});
