import { describe, it, expect } from 'bun:test';
import { transformMessagesToClientFormat, extractTurnMessages } from './messageConversion';
import type { PersistedMessage, PersistedToolCall } from '../providers/chatRepository/types';
import type { Message } from '../types';

describe('transformMessagesToClientFormat', () => {
  describe('user message multimodal reconstruction', () => {
    it('passes string user content through unchanged', () => {
      const persisted: PersistedMessage[] = [
        { id: 'u1', role: 'user', content: 'plain', createdAt: new Date() },
      ];
      const result = transformMessagesToClientFormat(persisted);
      expect(result[0].content).toBe('plain');
    });

    it('wraps transformed_file parts into the server-compatible text format', () => {
      const persisted: PersistedMessage[] = [
        {
          id: 'u1',
          role: 'user',
          content: [
            { type: 'text', text: 'intro' },
            {
              type: 'transformed_file',
              text: 'OCR body',
              originalFile: { name: 'doc.pdf', mimeType: 'application/pdf', size: 10 },
            },
          ],
          createdAt: new Date(),
        },
      ];
      const result = transformMessagesToClientFormat(persisted);
      expect(Array.isArray(result[0].content)).toBe(true);
      const parts = result[0].content as Array<{ type: string; text: string }>;
      expect(parts).toHaveLength(2);
      expect(parts[0]).toEqual({ type: 'text', text: 'intro' });
      expect(parts[1]).toEqual({
        type: 'text',
        text: '[Content of file "doc.pdf" (application/pdf)]:\n\nOCR body',
      });
    });

    it('drops legacy metadata-only file parts silently', () => {
      const persisted: PersistedMessage[] = [
        {
          id: 'u1',
          role: 'user',
          content: [
            { type: 'text', text: 'hi' },
            { type: 'file', file: { name: 'x.pdf', mimeType: 'application/pdf', size: 1 } },
          ],
          createdAt: new Date(),
        },
      ];
      const result = transformMessagesToClientFormat(persisted);
      const parts = result[0].content as Array<{ type: string; text: string }>;
      expect(parts).toHaveLength(1);
      expect(parts[0]).toEqual({ type: 'text', text: 'hi' });
    });

    it('restores an attachment_ref image as a ref-bearing image wire part', () => {
      const persisted: PersistedMessage[] = [
        {
          id: 'u1',
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            { type: 'attachment_ref', ref: 'tenant/ai/user/pic.png', name: 'pic.png', mimeType: 'image/png', size: 3 },
          ],
          createdAt: new Date(),
        },
      ];
      const result = transformMessagesToClientFormat(persisted);
      const parts = result[0].content as Array<Record<string, unknown>>;
      expect(parts).toHaveLength(2);
      expect(parts[0]).toEqual({ type: 'text', text: 'look' });
      expect(parts[1]).toEqual({ type: 'image_ref', ref: 'tenant/ai/user/pic.png' });
    });

    it('restores an attachment_ref PDF as a ref-bearing file wire part with mimeType and name', () => {
      const persisted: PersistedMessage[] = [
        {
          id: 'u1',
          role: 'user',
          content: [
            { type: 'attachment_ref', ref: 'tenant/ai/user/doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf', size: 9 },
          ],
          createdAt: new Date(),
        },
      ];
      const result = transformMessagesToClientFormat(persisted);
      const parts = result[0].content as Array<Record<string, unknown>>;
      expect(parts).toHaveLength(1);
      expect(parts[0]).toEqual({
        type: 'file_ref',
        ref: 'tenant/ai/user/doc.pdf',
        mimeType: 'application/pdf',
        name: 'doc.pdf',
      });
    });
  });

  describe('tool data preservation', () => {
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

  describe('reasoning parts preservation', () => {
    it('should preserve reasoningParts on assistant messages', () => {
      const persistedMessages: PersistedMessage[] = [
        {
          id: 'msg_1',
          role: 'assistant',
          content: 'The answer is 42.',
          createdAt: new Date(),
          reasoningParts: [
            { text: 'Let me think step by step...', encryptedValue: '{"anthropic":{"signature":"sig123"}}' },
          ],
        },
      ];

      const clientMessages = transformMessagesToClientFormat(persistedMessages);

      expect(clientMessages).toHaveLength(1);
      const msg = clientMessages[0] as Message & { reasoningParts?: unknown[] };
      expect(msg.reasoningParts).toHaveLength(1);
      expect((msg.reasoningParts![0] as { text: string }).text).toBe('Let me think step by step...');
      expect((msg.reasoningParts![0] as { encryptedValue?: string }).encryptedValue)
        .toBe('{"anthropic":{"signature":"sig123"}}');
    });

    it('should not include reasoningParts when absent', () => {
      const persistedMessages: PersistedMessage[] = [
        {
          id: 'msg_1',
          role: 'assistant',
          content: 'Hello!',
          createdAt: new Date(),
        },
      ];

      const clientMessages = transformMessagesToClientFormat(persistedMessages);

      const msg = clientMessages[0] as Message & { reasoningParts?: unknown };
      expect(msg.reasoningParts).toBeUndefined();
    });

    it('should not include reasoningParts when empty array', () => {
      const persistedMessages: PersistedMessage[] = [
        {
          id: 'msg_1',
          role: 'assistant',
          content: 'Hello!',
          createdAt: new Date(),
          reasoningParts: [],
        },
      ];

      const clientMessages = transformMessagesToClientFormat(persistedMessages);

      const msg = clientMessages[0] as Message & { reasoningParts?: unknown };
      expect(msg.reasoningParts).toBeUndefined();
    });

    it('should preserve reasoningParts alongside toolCalls', () => {
      const persistedMessages: PersistedMessage[] = [
        {
          id: 'msg_1',
          role: 'assistant',
          content: '',
          createdAt: new Date(),
          toolCalls: [
            {
              id: 'tc_1',
              type: 'function',
              function: { name: 'search', arguments: '{"q":"test"}' },
            },
          ],
          reasoningParts: [
            { text: 'I need to search for this.' },
          ],
        },
      ];

      const clientMessages = transformMessagesToClientFormat(persistedMessages);

      const msg = clientMessages[0] as Message & { reasoningParts?: unknown[]; toolCalls?: unknown[] };
      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.reasoningParts).toHaveLength(1);
    });
  });
});

describe('extractTurnMessages', () => {
  describe('reasoning parts preservation', () => {
    it('should preserve reasoningParts from intermediate assistant messages', () => {
      const messages: Message[] = [
        {
          id: 'ast_1',
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'tc_1', type: 'function' as const, function: { name: 'search', arguments: '{}' } },
          ],
          reasoningParts: [
            { text: 'Reasoning text', encryptedValue: '{"anthropic":{"signature":"sig"}}' },
          ],
        } as Message,
        {
          id: 'tool_1',
          role: 'tool',
          content: '"ok"',
          toolCallId: 'tc_1',
        } as Message,
        {
          id: 'ast_2',
          role: 'assistant',
          content: 'Done',
        } as Message,
      ];

      const turnMessages = extractTurnMessages(messages, 0);

      // Should extract assistant (with toolCalls + reasoning) + tool result
      // Final text-only assistant is excluded
      expect(turnMessages).toHaveLength(2);
      expect(turnMessages[0].role).toBe('assistant');
      expect(turnMessages[0].reasoningParts).toHaveLength(1);
      expect(turnMessages[0].reasoningParts![0].text).toBe('Reasoning text');
      expect(turnMessages[0].reasoningParts![0].encryptedValue).toBe('{"anthropic":{"signature":"sig"}}');
      expect(turnMessages[1].role).toBe('tool');
    });

    it('should not include reasoningParts when absent on intermediate messages', () => {
      const messages: Message[] = [
        {
          id: 'ast_1',
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'tc_1', type: 'function' as const, function: { name: 'addTodo', arguments: '{"text":"x"}' } },
          ],
        } as Message,
        {
          id: 'tool_1',
          role: 'tool',
          content: '{"success":true}',
          toolCallId: 'tc_1',
        } as Message,
      ];

      const turnMessages = extractTurnMessages(messages, 0);

      expect(turnMessages).toHaveLength(2);
      expect(turnMessages[0].reasoningParts).toBeUndefined();
    });

    it('should respect startIndex parameter', () => {
      const messages: Message[] = [
        // Before startIndex — should be ignored
        { id: 'user_0', role: 'user', content: 'Hello' } as Message,
        // After startIndex
        {
          id: 'ast_1',
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'tc_1', type: 'function' as const, function: { name: 'search', arguments: '{}' } },
          ],
          reasoningParts: [{ text: 'Thinking...' }],
        } as Message,
        {
          id: 'tool_1',
          role: 'tool',
          content: '"result"',
          toolCallId: 'tc_1',
        } as Message,
      ];

      const turnMessages = extractTurnMessages(messages, 1);

      expect(turnMessages).toHaveLength(2);
      expect(turnMessages[0].reasoningParts).toHaveLength(1);
    });
  });
});
