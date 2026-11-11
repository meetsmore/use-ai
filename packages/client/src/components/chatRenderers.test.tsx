import React from 'react';
import { describe, test, expect } from 'bun:test';
import { render } from '@testing-library/react';
import { MarkdownContent } from './MarkdownContent';
import { DefaultMessage } from './chatSlots';
import { ChatRenderersContext, type ChatCodeBlockRendererProps, type UseAIChatRenderers } from './chatRenderers';

const rendered: ChatCodeBlockRendererProps[] = [];

function VizBlock(props: ChatCodeBlockRendererProps) {
  rendered.push(props);
  return (
    <div data-testid="viz" data-complete={String(props.complete)}>
      {props.code}
    </div>
  );
}

const renderers: UseAIChatRenderers = { codeBlocks: { viz: VizBlock } };

function renderWithRenderers(content: string, value: UseAIChatRenderers = renderers) {
  rendered.length = 0;
  return render(
    <ChatRenderersContext.Provider value={value}>
      <MarkdownContent content={content} />
    </ChatRenderersContext.Provider>
  );
}

describe('chatRenderers.codeBlocks', () => {
  test('renders a registered language with its component instead of a <pre>', () => {
    const { getByTestId, container } = renderWithRenderers('Before\n\n```viz\n<div>chart</div>\n```\n\nAfter');

    expect(getByTestId('viz').textContent).toBe('<div>chart</div>');
    expect(container.querySelector('pre')).toBeNull();
    expect(rendered.at(-1)).toEqual({ code: '<div>chart</div>', language: 'viz', complete: true });
  });

  test('keeps the built-in <pre> for a language that is not registered', () => {
    const { container, queryByTestId } = renderWithRenderers('```sql\nSELECT 1\n```');

    expect(queryByTestId('viz')).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe('SELECT 1\n');
  });

  test('leaves inline code alone', () => {
    const { container, queryByTestId } = renderWithRenderers('Use `viz` blocks');

    expect(queryByTestId('viz')).toBeNull();
    expect(container.querySelector('p code')?.textContent).toBe('viz');
  });

  test('renders as before when no renderers are registered', () => {
    const { container } = render(<MarkdownContent content={'```viz\nx\n```'} />);

    expect(container.querySelector('pre code')?.textContent).toBe('x\n');
  });

  test('reports an unclosed fence as incomplete and a closed one as complete', () => {
    const completeOf = (content: string) => {
      const { container, unmount } = renderWithRenderers(content);
      const value = container.querySelector<HTMLElement>('[data-testid="viz"]')?.dataset.complete;
      unmount();
      return value;
    };

    expect(completeOf('```viz\n<div>par')).toBe('false');
    expect(completeOf('```viz\n<div>part</div>\n``')).toBe('false');
    expect(completeOf('```viz\n<div>part</div>\n```')).toBe('true');
    expect(completeOf('~~~viz\nx\n~~~')).toBe('true');
    // A closing fence needs at least as many backticks as the opening one.
    expect(completeOf('````viz\nx\n```')).toBe('false');
  });

  test('keeps the block mounted while its source streams in', () => {
    const steps = ['```viz\n<div>', '```viz\n<div>ch', '```viz\n<div>chart</div>', '```viz\n<div>chart</div>\n```'];
    const { getByTestId, rerender } = renderWithRenderers(steps[0]);
    const block = getByTestId('viz');

    for (const step of steps.slice(1)) {
      rerender(
        <ChatRenderersContext.Provider value={renderers}>
          <MarkdownContent content={step} />
        </ChatRenderersContext.Provider>
      );
      expect(getByTestId('viz')).toBe(block);
    }
    expect(block.textContent).toBe('<div>chart</div>');
    expect(block.dataset.complete).toBe('true');
  });

  test('applies when a custom Message slot renders DefaultMessage itself', () => {
    // meetsone's ask_user slot splits an answer and renders each part with
    // DefaultMessage, passing no renderer props: the context still reaches it.
    const { getByTestId } = render(
      <ChatRenderersContext.Provider value={renderers}>
        <DefaultMessage
          message={{ id: 'a', role: 'assistant', content: 'Here:\n\n```viz\nchart\n```', createdAt: new Date(0) }}
          index={0}
          isLast
          sourceMessages={[]}
          streaming={false}
          streamingParts={[]}
          feedbackEnabled={false}
        />
      </ChatRenderersContext.Provider>
    );

    expect(getByTestId('viz').textContent).toBe('chart');
  });
});
