import React from 'react';
import { describe, test, expect, beforeEach } from 'bun:test';
import { render } from '@testing-library/react';
import { UseAIChatPanel, type UseAIChatPanelProps } from './UseAIChatPanel';
import type { PersistedMessage } from '../providers/chatRepository/types';

const ANSWER = 'The first paragraph.\n\nThe second paragraph.';
const STREAMING_ID = 'msg-assistant';

const userMessage: PersistedMessage = {
  id: 'msg-user',
  role: 'user',
  content: 'question',
  createdAt: new Date(0),
};

/** The persisted answer carries the id that was allocated when the run started. */
const assistantMessage: PersistedMessage = {
  id: STREAMING_ID,
  role: 'assistant',
  content: ANSWER,
  createdAt: new Date(0),
  traceId: 'trace-1',
};

/**
 * Aborting a run that already produced text persists two messages: the partial
 * answer, then this notice. See persistFinalResponse in useServerEvents.
 */
const abortNotice: PersistedMessage = {
  id: 'msg-abort-notice',
  role: 'assistant',
  content: 'Generation stopped.',
  createdAt: new Date(0),
  displayMode: 'info',
};

function panelProps(overrides: Partial<UseAIChatPanelProps> = {}): UseAIChatPanelProps {
  return {
    onSendMessage: () => {},
    messages: [userMessage],
    loading: true,
    connected: true,
    streamingText: ANSWER,
    streamingMessageId: STREAMING_ID,
    ...overrides,
  };
}

/** Selects `text` inside the first text node that contains it. */
function selectText(container: HTMLElement, text: string): void {
  const walker = document.createTreeWalker(container, window.NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const index = node.data.indexOf(text);
    if (index === -1) continue;

    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + text.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  throw new Error(`"${text}" not found in container`);
}

/** Assistant bubbles, streaming or persisted. The two carry different test ids. */
function assistantBubbles(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-testid="chat-message-assistant"], [data-testid="chat-message-assistant-streaming"]'
    )
  );
}

describe('streaming answer rendered as a provisional message', () => {
  beforeEach(() => {
    window.getSelection()?.removeAllRanges();
  });

  test('renders the streamed text inside a normal assistant message bubble', () => {
    const { container } = render(<UseAIChatPanel {...panelProps()} />);
    const bubbles = assistantBubbles(container);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].textContent).toContain('The second paragraph.');
  });

  test('keeps the selection as more text arrives', () => {
    const { container, rerender } = render(<UseAIChatPanel {...panelProps({ streamingText: ANSWER })} />);
    selectText(container, 'first paragraph');

    rerender(<UseAIChatPanel {...panelProps({ streamingText: `${ANSWER}\n\nThe third paragraph.` })} />);

    expect(window.getSelection()!.toString()).toBe('first paragraph');
  });

  test('the persisted answer reuses the streaming bubble element', () => {
    const { container, rerender } = render(<UseAIChatPanel {...panelProps()} />);
    const streamingBubble = assistantBubbles(container)[0];

    rerender(
      <UseAIChatPanel
        {...panelProps({ loading: false, streamingText: '', streamingMessageId: null, messages: [userMessage, assistantMessage] })}
      />
    );

    const bubbles = assistantBubbles(container);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]).toBe(streamingBubble);
  });

  // The E2E suites wait on `chat-message-assistant` and read the answer from
  // `chat-message-content`, both meaning the answer is complete. The streaming
  // bubble must satisfy neither.
  test('takes the persisted test ids only once the answer is persisted', () => {
    const { container, rerender } = render(<UseAIChatPanel {...panelProps()} />);
    expect(container.querySelectorAll('[data-testid="chat-message-assistant"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="chat-message-assistant-streaming"]')).toHaveLength(1);
    const streamingBubble = assistantBubbles(container)[0];
    expect(streamingBubble.querySelector('[data-testid="chat-message-content"]')).toBeNull();
    expect(streamingBubble.querySelector('[data-testid="chat-message-content-streaming"]')).not.toBeNull();

    rerender(
      <UseAIChatPanel
        {...panelProps({ loading: false, streamingText: '', streamingMessageId: null, messages: [userMessage, assistantMessage] })}
      />
    );

    expect(container.querySelectorAll('[data-testid="chat-message-assistant"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="chat-message-assistant-streaming"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="chat-message-content-streaming"]')).toHaveLength(0);
    expect(assistantBubbles(container)[0].querySelector('[data-testid="chat-message-content"]')).not.toBeNull();
  });

  test('keeps the selection when the streamed answer becomes a persisted message', () => {
    const { container, rerender } = render(<UseAIChatPanel {...panelProps()} />);
    selectText(container, 'second paragraph');

    rerender(
      <UseAIChatPanel
        {...panelProps({ loading: false, streamingText: '', streamingMessageId: null, messages: [userMessage, assistantMessage] })}
      />
    );

    const selection = window.getSelection()!;
    expect(selection.toString()).toBe('second paragraph');
    expect(container.contains(selection.anchorNode)).toBe(true);
  });

  test('keeps the selection when the user stops the run', () => {
    const { container, rerender } = render(<UseAIChatPanel {...panelProps()} />);
    selectText(container, 'second paragraph');

    rerender(
      <UseAIChatPanel
        {...panelProps({
          loading: false,
          streamingText: '',
          streamingMessageId: null,
          messages: [userMessage, assistantMessage, abortNotice],
        })}
      />
    );

    const selection = window.getSelection()!;
    expect(selection.toString()).toBe('second paragraph');
    expect(container.contains(selection.anchorNode)).toBe(true);
  });

  // saveAIResponse appends the persisted message before the run UI state
  // resets, so for one render both the persisted answer and the streaming text
  // exist. Only one bubble may show.
  test('shows one bubble while the persisted answer and the streaming text overlap', () => {
    const { container } = render(
      <UseAIChatPanel {...panelProps({ messages: [userMessage, assistantMessage] })} />
    );
    expect(assistantBubbles(container)).toHaveLength(1);
  });

  test('shows the plain loading indicator before any text streams', () => {
    const { container } = render(<UseAIChatPanel {...panelProps({ streamingText: '', streamingReasoning: '' })} />);
    expect(assistantBubbles(container)).toHaveLength(0);
    expect(container.querySelector('.dots')).not.toBeNull();
  });

  test('shows the loading indicator inside the bubble while only reasoning streams', () => {
    const { container } = render(
      <UseAIChatPanel {...panelProps({ streamingText: '', streamingReasoning: 'thinking...' })} />
    );
    const bubbles = assistantBubbles(container);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].querySelector('.dots')).not.toBeNull();
  });

  test('does not show a timestamp or feedback buttons while streaming', () => {
    const { container } = render(<UseAIChatPanel {...panelProps({ feedbackEnabled: true, onFeedback: () => {} })} />);
    const bubble = assistantBubbles(container)[0];
    expect(bubble.querySelector('[data-testid="feedback-buttons"]')).toBeNull();
    expect(bubble.querySelector('[data-testid="message-timestamp"]')).toBeNull();
  });

  test('falls back to a bubble without a stable key when no streaming id is given', () => {
    const { container } = render(<UseAIChatPanel {...panelProps({ streamingMessageId: undefined })} />);
    expect(assistantBubbles(container)).toHaveLength(1);
  });
});
