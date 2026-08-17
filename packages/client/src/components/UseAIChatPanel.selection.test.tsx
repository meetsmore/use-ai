import React from 'react';
import { describe, test, expect, beforeEach } from 'bun:test';
import { render } from '@testing-library/react';
import { UseAIChatPanel, type UseAIChatPanelProps } from './UseAIChatPanel';
import type { PersistedMessage } from '../providers/chatRepository/types';

const ANSWER = 'The first paragraph.\n\nThe second paragraph.';

const userMessage: PersistedMessage = {
  id: 'msg-user',
  role: 'user',
  content: 'question',
  createdAt: new Date(0),
};

const assistantMessage: PersistedMessage = {
  id: 'msg-assistant',
  role: 'assistant',
  content: ANSWER,
  createdAt: new Date(0),
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
    // Browsers fire this on every selection change; jsdom does not.
    document.dispatchEvent(new window.Event('selectionchange'));
    return;
  }
  throw new Error(`"${text}" not found in container`);
}

describe('selecting the answer while it streams', () => {
  beforeEach(() => {
    window.getSelection()?.removeAllRanges();
  });

  // Text the model has already written keeps its DOM nodes, so a selection over
  // it holds while the rest of the answer streams in. (The paragraph currently
  // being written is the exception: replacing a text node's data collapses any
  // range inside it, which is how every browser behaves.)
  test('keeps the selection as more text arrives', () => {
    const { container, rerender } = render(<UseAIChatPanel {...panelProps({ streamingText: ANSWER })} />);
    selectText(container, 'first paragraph');

    rerender(<UseAIChatPanel {...panelProps({ streamingText: `${ANSWER}\n\nThe third paragraph.` })} />);

    expect(window.getSelection()!.toString()).toBe('first paragraph');
  });

  test('keeps the selection when the streamed answer becomes a persisted message', () => {
    const { container, rerender } = render(<UseAIChatPanel {...panelProps()} />);
    selectText(container, 'second paragraph');

    rerender(
      <UseAIChatPanel
        {...panelProps({
          loading: false,
          streamingText: '',
          messages: [userMessage, assistantMessage],
        })}
      />
    );

    const selection = window.getSelection()!;
    expect(selection.toString()).toBe('second paragraph');
    // Matching text alone would also pass with the range still sitting on the
    // unmounted streaming bubble's detached nodes.
    expect(container.querySelector('.markdown-answer')!.contains(selection.anchorNode)).toBe(true);
  });

  // The user selects text mid-stream and then presses stop. The notice bubble
  // that abort appends is the last assistant message, but it renders as a plain
  // pill with no answer wrapper, so treating it as the answer would leave the
  // handoff with nothing to restore onto and drop the selection.
  test('restores the selection onto the answer when the user stops the run', () => {
    const { container, rerender } = render(<UseAIChatPanel {...panelProps()} />);
    selectText(container, 'second paragraph');

    rerender(
      <UseAIChatPanel
        {...panelProps({
          loading: false,
          streamingText: '',
          messages: [userMessage, assistantMessage, abortNotice],
        })}
      />
    );

    const selection = window.getSelection()!;
    expect(selection.toString()).toBe('second paragraph');
    expect(container.querySelector('.markdown-answer')!.contains(selection.anchorNode)).toBe(true);
  });

  test('does not restore a selection the user never made', () => {
    const { rerender } = render(<UseAIChatPanel {...panelProps()} />);

    rerender(
      <UseAIChatPanel
        {...panelProps({
          loading: false,
          streamingText: '',
          messages: [userMessage, assistantMessage],
        })}
      />
    );

    expect(window.getSelection()!.toString()).toBe('');
  });
});
