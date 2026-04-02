import { describe, it, expect } from 'bun:test';
import { mergeAssistantMessagesForDisplay } from './mergeAssistantMessages';
import type { PersistedMessage } from '../providers/chatRepository/types';

/**
 * Tests for merging consecutive assistant messages into single display messages.
 *
 * Data structure (for LLM API): per-step assistant messages with their own text.
 * Display (for UI): all assistant text within a turn combined into one bubble.
 *
 * Example turn:
 *   assistant(text="Planning...", toolCalls=[tc1]) → tool → assistant(text="Done!")
 * LLM sees: two assistant messages with separate text (correct)
 * UI shows: one bubble with "Planning...\n\nDone!" (combined)
 */
describe('mergeAssistantMessagesForDisplay', () => {
  it('single text-only assistant message is unchanged', () => {
    const messages = [
      { id: '1', role: 'user', content: 'Hello' },
      { id: '2', role: 'assistant', content: 'Hi there!' },
    ];

    const result = mergeAssistantMessagesForDisplay(messages as PersistedMessage[]);
    expect(result.length).toBe(2);
    expect(result[1].content).toBe('Hi there!');
  });

  it('combines intermediate assistant text with final assistant text in one turn', () => {
    const messages = [
      { id: '1', role: 'user', content: 'Do something' },
      { id: '2', role: 'assistant', content: 'Planning...', toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'search', arguments: '{}' } }] },
      { id: '3', role: 'tool', content: '{"ok":true}', toolCallId: 'tc1' },
      { id: '4', role: 'assistant', content: 'Done!' },
    ];

    const result = mergeAssistantMessagesForDisplay(messages as PersistedMessage[]);

    // Should be: user + one combined assistant
    expect(result.length).toBe(2);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
    expect(result[1].content).toBe('Planning...\n\nDone!');
  });

  it('combines three steps into one bubble', () => {
    const messages = [
      { id: '1', role: 'user', content: 'Multi-step task' },
      // Step 0
      { id: '2', role: 'assistant', content: 'Step 0 text.', toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'tool1', arguments: '{}' } }] },
      { id: '3', role: 'tool', content: '{}', toolCallId: 'tc1' },
      // Step 1
      { id: '4', role: 'assistant', content: 'Step 1 text.', toolCalls: [{ id: 'tc2', type: 'function', function: { name: 'tool2', arguments: '{}' } }] },
      { id: '5', role: 'tool', content: '{}', toolCallId: 'tc2' },
      // Step 2 (final)
      { id: '6', role: 'assistant', content: 'Final text.' },
    ];

    const result = mergeAssistantMessagesForDisplay(messages as PersistedMessage[]);

    expect(result.length).toBe(2);
    expect(result[1].content).toBe('Step 0 text.\n\nStep 1 text.\n\nFinal text.');
  });

  it('handles intermediate assistant with no text (tool-only step)', () => {
    const messages = [
      { id: '1', role: 'user', content: 'Do it' },
      // Step 0: tool only (no text)
      { id: '2', role: 'assistant', content: '', toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'tool1', arguments: '{}' } }] },
      { id: '3', role: 'tool', content: '{}', toolCallId: 'tc1' },
      // Step 1: final text
      { id: '4', role: 'assistant', content: 'All done.' },
    ];

    const result = mergeAssistantMessagesForDisplay(messages as PersistedMessage[]);

    expect(result.length).toBe(2);
    expect(result[1].content).toBe('All done.');
  });

  it('handles multiple turns correctly', () => {
    const messages = [
      // Turn 1
      { id: '1', role: 'user', content: 'First question' },
      { id: '2', role: 'assistant', content: 'Thinking...', toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'search', arguments: '{}' } }] },
      { id: '3', role: 'tool', content: '{}', toolCallId: 'tc1' },
      { id: '4', role: 'assistant', content: 'Answer 1.' },
      // Turn 2
      { id: '5', role: 'user', content: 'Second question' },
      { id: '6', role: 'assistant', content: 'Answer 2.' },
    ];

    const result = mergeAssistantMessagesForDisplay(messages as PersistedMessage[]);

    expect(result.length).toBe(4);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
    expect(result[1].content).toBe('Thinking...\n\nAnswer 1.');
    expect(result[2].role).toBe('user');
    expect(result[3].role).toBe('assistant');
    expect(result[3].content).toBe('Answer 2.');
  });

  it('preserves non-toolCalls properties on the merged message', () => {
    const messages = [
      { id: '1', role: 'user', content: 'Go' },
      { id: '2', role: 'assistant', content: 'Step text.', toolCalls: [{ id: 'tc1', type: 'function', function: { name: 't', arguments: '{}' } }] },
      { id: '3', role: 'tool', content: '{}', toolCallId: 'tc1' },
      { id: '4', role: 'assistant', content: 'Final.', traceId: 'trace-123', displayMode: 'default' },
    ];

    const result = mergeAssistantMessagesForDisplay(messages as PersistedMessage[]);

    // Merged message should use the final message's id and other properties
    const merged = result[1];
    expect(merged.id).toBe('4');
    expect((merged as PersistedMessage[]).traceId).toBe('trace-123');
  });

  it('filters out tool messages', () => {
    const messages = [
      { id: '1', role: 'user', content: 'Hi' },
      { id: '2', role: 'assistant', content: 'Calling tool.', toolCalls: [{ id: 'tc1', type: 'function', function: { name: 't', arguments: '{}' } }] },
      { id: '3', role: 'tool', content: 'result', toolCallId: 'tc1' },
      { id: '4', role: 'assistant', content: 'Done.' },
    ];

    const result = mergeAssistantMessagesForDisplay(messages as PersistedMessage[]);

    // No tool messages in output
    expect(result.every(m => m.role !== 'tool')).toBe(true);
  });

  it('uses getTextFromContent for content extraction', () => {
    // Content could be a ContentPart array (multimodal) or string
    const messages = [
      { id: '1', role: 'user', content: 'test' },
      { id: '2', role: 'assistant', content: [{ type: 'text', text: 'From array.' }], toolCalls: [{ id: 'tc1', type: 'function', function: { name: 't', arguments: '{}' } }] },
      { id: '3', role: 'tool', content: '{}', toolCallId: 'tc1' },
      { id: '4', role: 'assistant', content: 'From string.' },
    ];

    const result = mergeAssistantMessagesForDisplay(messages as PersistedMessage[]);

    expect(result[1].content).toBe('From array.\n\nFrom string.');
  });
});
