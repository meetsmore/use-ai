import { describe, it, expect } from 'bun:test';
import { transformMessagesToClientFormat } from './messageConversion';
import type { PersistedMessage, PersistedToolCall } from '../providers/chatRepository/types';

describe('transformMessagesToClientFormat should preserve tool data', () => {
  it('should preserve toolCalls on assistant messages', () => {
    const persistedMessages: PersistedMessage[] = [
      {
        id: 'msg_1',
        role: 'user',
        content: 'Add a todo: buy groceries',
        createdAt: new Date(),
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: '',
        createdAt: new Date(),
        toolCalls: [
          {
            id: 'toolu_123',
            type: 'function',
            function: {
              name: 'addTodo',
              arguments: '{"text":"buy groceries"}',
            },
          },
        ],
      },
    ];

    const clientMessages = transformMessagesToClientFormat(persistedMessages);

    const assistantMsg = clientMessages.find((m) => m.id === 'msg_2');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.toolCalls).toBeDefined();
    expect(
      (assistantMsg!.toolCalls as PersistedToolCall[])[0].function.name
    ).toBe('addTodo');
  });

  it('should preserve toolCallId on tool messages', () => {
    const persistedMessages: PersistedMessage[] = [
      {
        id: 'msg_tool_1',
        role: 'tool',
        content: '{"success":true}',
        createdAt: new Date(),
        toolCallId: 'toolu_123',
      },
    ];

    const clientMessages = transformMessagesToClientFormat(persistedMessages);

    const toolMsg = clientMessages[0];
    expect(toolMsg.toolCallId).toBe('toolu_123');
    expect(toolMsg.role).toBe('tool');
  });

  it('should include tool messages in the output', () => {
    const persistedMessages: PersistedMessage[] = [
      {
        id: 'msg_1',
        role: 'user',
        content: 'Add a todo',
        createdAt: new Date(),
      },
      {
        id: 'msg_2',
        role: 'assistant',
        content: '',
        createdAt: new Date(),
        toolCalls: [
          {
            id: 'toolu_123',
            type: 'function',
            function: {
              name: 'addTodo',
              arguments: '{"text":"buy groceries"}',
            },
          },
        ],
      },
      {
        id: 'msg_3',
        role: 'tool',
        content: '{"success":true}',
        createdAt: new Date(),
        toolCallId: 'toolu_123',
      },
      {
        id: 'msg_4',
        role: 'assistant',
        content: 'Done!',
        createdAt: new Date(),
      },
    ];

    const clientMessages = transformMessagesToClientFormat(persistedMessages);

    expect(clientMessages).toHaveLength(4);
    const roles = clientMessages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });
});
