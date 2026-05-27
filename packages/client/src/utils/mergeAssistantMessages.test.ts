import { describe, it, expect } from 'bun:test';
import { mergeAssistantMessagesForDisplay } from './mergeAssistantMessages';
import type { PersistedMessage } from '../providers/chatRepository/types';

function msg(overrides: Partial<PersistedMessage> & { id: string; role: string }): PersistedMessage {
  return { content: '', createdAt: new Date(), ...overrides } as PersistedMessage;
}

const tc = (id: string, name: string) => ({
  id, type: 'function' as const, function: { name, arguments: '{}' },
});

describe('mergeAssistantMessagesForDisplay', () => {
  it('passes through a simple user → assistant exchange unchanged', () => {
    const result = mergeAssistantMessagesForDisplay([
      msg({ id: '1', role: 'user', content: 'Hi' }),
      msg({ id: '2', role: 'assistant', content: 'Hello!' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[1].content).toBe('Hello!');
  });

  it('merges intermediate + final assistant text, filters tool messages', () => {
    const result = mergeAssistantMessagesForDisplay([
      msg({ id: '1', role: 'user', content: 'Do it' }),
      msg({ id: '2', role: 'assistant', content: 'Planning...', toolCalls: [tc('tc1', 'search')] }),
      msg({ id: '3', role: 'tool', content: '{}', toolCallId: 'tc1' }),
      msg({ id: '4', role: 'assistant', content: 'Done!' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[1].content).toBe('Planning...\n\nDone!');
    expect(result.every(m => m.role !== 'tool')).toBe(true);
  });

  it('merges 3-step turn into one bubble', () => {
    const result = mergeAssistantMessagesForDisplay([
      msg({ id: '1', role: 'user', content: 'Go' }),
      msg({ id: '2', role: 'assistant', content: 'Step 0.', toolCalls: [tc('tc1', 't1')] }),
      msg({ id: '3', role: 'tool', content: '{}', toolCallId: 'tc1' }),
      msg({ id: '4', role: 'assistant', content: 'Step 1.', toolCalls: [tc('tc2', 't2')] }),
      msg({ id: '5', role: 'tool', content: '{}', toolCallId: 'tc2' }),
      msg({ id: '6', role: 'assistant', content: 'Final.' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[1].content).toBe('Step 0.\n\nStep 1.\n\nFinal.');
  });

  it('skips empty text on tool-only intermediate step', () => {
    const result = mergeAssistantMessagesForDisplay([
      msg({ id: '1', role: 'user', content: 'Go' }),
      msg({ id: '2', role: 'assistant', content: '', toolCalls: [tc('tc1', 't1')] }),
      msg({ id: '3', role: 'tool', content: '{}', toolCallId: 'tc1' }),
      msg({ id: '4', role: 'assistant', content: 'Done.' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[1].content).toBe('Done.');
  });

  it('handles multiple turns independently', () => {
    const result = mergeAssistantMessagesForDisplay([
      msg({ id: '1', role: 'user', content: 'Q1' }),
      msg({ id: '2', role: 'assistant', content: 'Thinking...', toolCalls: [tc('tc1', 's')] }),
      msg({ id: '3', role: 'tool', content: '{}', toolCallId: 'tc1' }),
      msg({ id: '4', role: 'assistant', content: 'A1.' }),
      msg({ id: '5', role: 'user', content: 'Q2' }),
      msg({ id: '6', role: 'assistant', content: 'A2.' }),
    ]);
    expect(result).toHaveLength(4);
    expect(result[1].content).toBe('Thinking...\n\nA1.');
    expect(result[3].content).toBe('A2.');
  });

  it('preserves final message properties (id, traceId)', () => {
    const result = mergeAssistantMessagesForDisplay([
      msg({ id: '1', role: 'user', content: 'Go' }),
      msg({ id: '2', role: 'assistant', content: 'Step.', toolCalls: [tc('tc1', 't')] }),
      msg({ id: '3', role: 'tool', content: '{}', toolCallId: 'tc1' }),
      msg({ id: '4', role: 'assistant', content: 'Final.', traceId: 'trace-1' } as PersistedMessage),
    ]);
    expect(result[1].id).toBe('4');
    expect((result[1] as unknown as { traceId: string }).traceId).toBe('trace-1');
  });

  it('returns empty array for empty input', () => {
    expect(mergeAssistantMessagesForDisplay([])).toHaveLength(0);
  });

  it('flushes trailing pending text when no final assistant exists yet', () => {
    // Simulates a streaming multi-step run where the final text-only assistant
    // message has not arrived yet (run still in progress)
    const result = mergeAssistantMessagesForDisplay([
      msg({ id: '1', role: 'user', content: 'Go' }),
      msg({ id: '2', role: 'assistant', content: 'Working...', toolCalls: [tc('tc1', 't1')] }),
      msg({ id: '3', role: 'tool', content: '{}', toolCallId: 'tc1' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
    expect(result[1].content).toBe('Working...');
    expect(result[1].id).toBe('merged-2');
  });

  it('produces deterministic IDs from constituent message IDs', () => {
    const input = [
      msg({ id: '1', role: 'user', content: 'Go' }),
      msg({ id: 'a1', role: 'assistant', content: 'S0.', toolCalls: [tc('tc1', 't')] }),
      msg({ id: '2', role: 'tool', content: '{}', toolCallId: 'tc1' }),
      msg({ id: 'a2', role: 'assistant', content: 'S1.', toolCalls: [tc('tc2', 't')] }),
      msg({ id: '3', role: 'tool', content: '{}', toolCallId: 'tc2' }),
    ];
    const r1 = mergeAssistantMessagesForDisplay(input);
    const r2 = mergeAssistantMessagesForDisplay(input);
    expect(r1[1].id).toBe('merged-a1-a2');
    expect(r1[1].id).toBe(r2[1].id);
  });

  it('extracts text from ContentPart arrays', () => {
    const result = mergeAssistantMessagesForDisplay([
      msg({ id: '1', role: 'user', content: 'Go' }),
      msg({ id: '2', role: 'assistant', content: [{ type: 'text', text: 'From array.' }] as never, toolCalls: [tc('tc1', 't')] }),
      msg({ id: '3', role: 'tool', content: '{}', toolCallId: 'tc1' }),
      msg({ id: '4', role: 'assistant', content: 'From string.' }),
    ]);
    expect(result[1].content).toBe('From array.\n\nFrom string.');
  });

  it('collects reasoning parts from intermediate and final messages', () => {
    const result = mergeAssistantMessagesForDisplay([
      msg({ id: '1', role: 'user', content: 'Go' }),
      msg({
        id: '2', role: 'assistant', content: 'Step 0.',
        toolCalls: [tc('tc1', 't')],
        reasoningParts: [{ text: 'Thinking step 0', encryptedValue: JSON.stringify({ anthropic: { signature: 'sig0' } }) }],
      }),
      msg({ id: '3', role: 'tool', content: '{}', toolCallId: 'tc1' }),
      msg({
        id: '4', role: 'assistant', content: 'Final.',
        reasoningParts: [{ text: 'Thinking final', encryptedValue: JSON.stringify({ anthropic: { signature: 'sig1' } }) }],
      }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[1].reasoningParts).toHaveLength(2);
    expect(result[1].reasoningParts![0].text).toBe('Thinking step 0');
    expect(result[1].reasoningParts![1].text).toBe('Thinking final');
  });

  it('preserves reasoning on trailing pending flush', () => {
    const result = mergeAssistantMessagesForDisplay([
      msg({ id: '1', role: 'user', content: 'Go' }),
      msg({
        id: '2', role: 'assistant', content: 'Working...',
        toolCalls: [tc('tc1', 't')],
        reasoningParts: [{ text: 'Planning' }],
      }),
      msg({ id: '3', role: 'tool', content: '{}', toolCallId: 'tc1' }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[1].reasoningParts).toHaveLength(1);
    expect(result[1].reasoningParts![0].text).toBe('Planning');
  });

  it('does not add reasoningParts when none exist', () => {
    const result = mergeAssistantMessagesForDisplay([
      msg({ id: '1', role: 'user', content: 'Hi' }),
      msg({ id: '2', role: 'assistant', content: 'Hello!' }),
    ]);
    expect(result[1].reasoningParts).toBeUndefined();
  });

  it('keeps an info notice standalone after a tool-call step (does not merge or leak displayMode)', () => {
    const result = mergeAssistantMessagesForDisplay([
      msg({ id: '1', role: 'user', content: 'Wait 5s' }),
      msg({ id: '2', role: 'assistant', content: 'Let me run the wait tool.', toolCalls: [tc('tc1', 'wait')] }),
      msg({ id: '3', role: 'tool', content: '{"aborted":true}', toolCallId: 'tc1' }),
      msg({ id: '4', role: 'assistant', content: 'Generation stopped.', displayMode: 'info' }),
    ]);
    // user, merged partial (from the tool-call step), standalone info notice
    expect(result).toHaveLength(3);
    expect(result[1].content).toBe('Let me run the wait tool.');
    expect(result[1].displayMode).toBeUndefined();
    expect(result[2].content).toBe('Generation stopped.');
    expect(result[2].displayMode).toBe('info');
  });

  it('keeps an info notice standalone after a plain text reply', () => {
    const result = mergeAssistantMessagesForDisplay([
      msg({ id: '1', role: 'user', content: 'Hi' }),
      msg({ id: '2', role: 'assistant', content: 'Partial repl' }),
      msg({ id: '3', role: 'assistant', content: 'Generation stopped.', displayMode: 'info' }),
    ]);
    expect(result).toHaveLength(3);
    expect(result[1].content).toBe('Partial repl');
    expect(result[1].displayMode).toBeUndefined();
    expect(result[2].displayMode).toBe('info');
  });
});
