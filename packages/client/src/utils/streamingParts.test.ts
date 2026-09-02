import { describe, it, expect } from 'bun:test';
import {
  getReasoningPartsFromStreamingParts,
  getTextFromStreamingParts,
  hasStreamedAnswerContent,
} from './streamingParts';
import { mergeAssistantMessagesForDisplay } from './mergeAssistantMessages';
import type { PersistedMessage } from '../providers/chatRepository/types';
import type { ChatStreamingPart } from '../hooks/useServerEvents';

/** A run that thinks, calls a tool, thinks again and answers in two steps. */
const PARTS: ChatStreamingPart[] = [
  { kind: 'reasoning', text: 'Need the time.' },
  { kind: 'tool_call', toolCallId: 'tc1', name: 'getServerTime', args: '{}' },
  { kind: 'text', text: 'Checking the clock.' },
  { kind: 'reasoning', text: 'Now the sum.' },
  { kind: 'text', text: 'It is noon.' },
];

describe('getTextFromStreamingParts', () => {
  it('joins the text steps with a blank line and ignores the rest', () => {
    expect(getTextFromStreamingParts(PARTS)).toBe('Checking the clock.\n\nIt is noon.');
  });

  // A part is pushed on TEXT_MESSAGE_START, before any delta arrives, so an
  // empty one exists for a render. Joining it would prepend a blank line.
  it('skips a step that has not received any text yet', () => {
    expect(getTextFromStreamingParts([{ kind: 'text', text: '' }, { kind: 'text', text: 'A' }])).toBe('A');
  });

  it('is empty for a run that has only thought so far', () => {
    expect(getTextFromStreamingParts([{ kind: 'reasoning', text: 'Hmm.' }])).toBe('');
  });

  /**
   * The provisional bubble and the persisted one render one after the other
   * into the same element. A different string remounts it, dropping the text
   * selection the user was making, so the two flattenings must agree.
   */
  it('produces the string mergeAssistantMessagesForDisplay produces for the same run', () => {
    const persisted: PersistedMessage[] = [
      { id: 'u1', role: 'user', content: 'what time is it?', createdAt: new Date(0) },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Checking the clock.',
        createdAt: new Date(0),
        toolCalls: [{ id: 'tc1', type: 'function' as const, function: { name: 'getServerTime', arguments: '{}' } }],
      },
      { id: 't1', role: 'tool', content: 'noon', createdAt: new Date(0) },
      { id: 'a2', role: 'assistant', content: 'It is noon.', createdAt: new Date(0) },
    ];

    const merged = mergeAssistantMessagesForDisplay(persisted);
    const assistant = merged.find((message) => message.role === 'assistant');

    expect(assistant?.content).toBe(getTextFromStreamingParts(PARTS));
  });
});

describe('getReasoningPartsFromStreamingParts', () => {
  it('keeps each step of reasoning as its own part', () => {
    expect(getReasoningPartsFromStreamingParts(PARTS)).toEqual([
      { text: 'Need the time.' },
      { text: 'Now the sum.' },
    ]);
  });

  it('skips a step that has not received any reasoning yet', () => {
    expect(getReasoningPartsFromStreamingParts([{ kind: 'reasoning', text: '' }])).toEqual([]);
  });
});

describe('hasStreamedAnswerContent', () => {
  it('is true once a step has produced text', () => {
    expect(hasStreamedAnswerContent([{ kind: 'text', text: 'A' }])).toBe(true);
  });

  it('is true once a step has produced reasoning', () => {
    expect(hasStreamedAnswerContent([{ kind: 'reasoning', text: 'Hmm.' }])).toBe(true);
  });

  // A tool call runs before the answer says anything. The bubble would be empty
  // for the whole call, and the pending indicator that names the running tool
  // would be suppressed behind it.
  it('is false while only a tool call has started', () => {
    expect(hasStreamedAnswerContent([
      { kind: 'tool_call', toolCallId: 'tc1', name: 'search', args: '' },
    ])).toBe(false);
  });

  it('is false for a step opened before its first delta', () => {
    expect(hasStreamedAnswerContent([{ kind: 'text', text: '' }])).toBe(false);
  });

  it('is false between runs', () => {
    expect(hasStreamedAnswerContent([])).toBe(false);
  });
});
