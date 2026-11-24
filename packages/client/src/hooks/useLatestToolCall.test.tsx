import { describe, it, expect } from 'bun:test';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useLatestToolCall } from './useLatestToolCall';
import { __UseAIChatContext, type ChatUIContextValue } from '../components/UseAIChat';
import type { ChatStreamingPart } from './useServerEvents';
import type { PersistedMessage } from '../providers/chatRepository/types';

const at = new Date(0);
const savedTurn: PersistedMessage[] = [
  {
    id: 'a1', role: 'assistant', content: '', createdAt: at,
    toolCalls: [{ id: 'old', type: 'function', function: { name: 'update_todos', arguments: '{"items":["saved"]}' } }],
  },
  { id: 't1', role: 'tool', content: '{"ok":true}', toolCallId: 'old', createdAt: at },
];

function render(messages: PersistedMessage[], streamingParts: ChatStreamingPart[], toolName = 'update_todos') {
  const value = { messages, streamingParts } as unknown as ChatUIContextValue;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <__UseAIChatContext.Provider value={value}>{children}</__UseAIChatContext.Provider>
  );
  return renderHook(() => useLatestToolCall<{ items: string[] }, { ok: boolean }>(toolName), { wrapper }).result.current;
}

describe('useLatestToolCall', () => {
  it('prefers the answer being streamed', () => {
    const latest = render(savedTurn, [
      { kind: 'tool_call', toolCallId: 'new', name: 'update_todos', args: '{"items":["live"]}', status: 'running' },
    ]);
    expect(latest).toEqual({ toolCallId: 'new', status: 'running', args: { items: ['live'] }, streaming: true });
  });

  it('skips a call whose arguments are still arriving', () => {
    const latest = render(savedTurn, [
      { kind: 'tool_call', toolCallId: 'new', name: 'update_todos', args: '{"items":["li', status: 'receiving-args' },
    ]);
    expect(latest?.toolCallId).toBe('old');
  });

  it('falls back to the saved messages, with the parsed result', () => {
    expect(render(savedTurn, [])).toEqual({
      toolCallId: 'old', status: 'done', args: { items: ['saved'] }, result: { ok: true }, streaming: false,
    });
  });

  it('keeps the null result of a tool that returned nothing', () => {
    const latest = render([], [
      { kind: 'tool_call', toolCallId: 'void', name: 'update_todos', args: '{"items":[]}', status: 'done', result: 'null' },
    ]);
    expect(latest?.result).toBeNull();
  });

  it('matches the tool name exactly', () => {
    expect(render(savedTurn, [], 'todos')).toBeNull();
  });

  it('returns null outside a UseAIProvider', () => {
    expect(renderHook(() => useLatestToolCall('update_todos')).result.current).toBeNull();
  });
});
