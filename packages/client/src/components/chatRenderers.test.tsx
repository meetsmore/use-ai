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
    <div data-testid="viz">
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
    expect(rendered.at(-1)).toEqual({ code: '<div>chart</div>', language: 'viz' });
  });

  test('keeps the built-in <pre> for a language that is not registered', () => {
    const { container, queryByTestId } = renderWithRenderers('```sql\nSELECT 1\n```');

    expect(queryByTestId('viz')).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe('SELECT 1\n');
  });

  for (const language of ['constructor', 'valueOf', '__proto__', 'toString']) {
    test(`keeps plain code for the unregistered inherited name ${language}`, () => {
      const { container, queryByTestId } = renderWithRenderers(`\`\`\`${language}\nx\n\`\`\``);

      expect(queryByTestId('viz')).toBeNull();
      expect(container.querySelector('pre code')?.textContent).toBe('x\n');
    });

    test(`renders an explicitly registered ${language} language`, () => {
      const { container, getByTestId } = renderWithRenderers(`\`\`\`${language}\nx\n\`\`\``, {
        codeBlocks: { [language]: VizBlock },
      });

      expect(getByTestId('viz').textContent).toBe('x');
      expect(container.querySelector('pre')).toBeNull();
    });
  }

  test('recovers from partial code while preserving the rest of the answer', () => {
    function JsonBlock({ code }: ChatCodeBlockRendererProps) {
      const value = JSON.parse(code) as { title: string };
      return <div data-testid="json">{value.title}</div>;
    }
    const value = { codeBlocks: { viz: VizBlock, json: JsonBlock } };
    const answer = (code: string) => (
      <ChatRenderersContext.Provider value={value}>
        <MarkdownContent content={`Before\n\n\`\`\`viz\nchart\n\`\`\`\n\n\`\`\`json\n${code}`} />
      </ChatRenderersContext.Provider>
    );
    const { container, getByTestId, queryByTestId, getByText, rerender } = render(answer('{"title":'));
    const otherBlock = getByTestId('viz');
    const paragraph = getByText('Before');

    expect(queryByTestId('json')).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe('{"title":\n');

    rerender(answer('{"title":"Sales"'));
    expect(queryByTestId('json')).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe('{"title":"Sales"\n');

    // Valid input can render before the closing fence arrives.
    rerender(answer('{"title":"Sales"}'));
    const block = getByTestId('json');
    expect(block.textContent).toBe('Sales');
    expect(container.querySelector('pre')).toBeNull();

    rerender(answer('{"title":"Sales"}\n\`\`\`\n\nAfter'));
    expect(getByTestId('json')).toBe(block);
    expect(getByText('After')).not.toBeNull();

    // An already mounted renderer can also fail and recover on a later update.
    rerender(answer('{"title":"Revenue"'));
    expect(queryByTestId('json')).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe('{"title":"Revenue"\n');

    rerender(answer('{"title":"Revenue"}\n\`\`\`'));
    expect(getByTestId('json').textContent).toBe('Revenue');
    expect(container.querySelector('pre')).toBeNull();
    expect(getByTestId('viz')).toBe(otherBlock);
    expect(getByText('Before')).toBe(paragraph);
  });

  test('keeps failed code visible and retries when its registered component changes', () => {
    let attempts = 0;
    function BrokenBlock(): React.ReactElement {
      attempts++;
      throw new Error('Cannot render this block');
    }
    const value = { codeBlocks: { viz: BrokenBlock } };
    const content = '```viz\nchart\n```';
    const { container, rerender, getByTestId, getByText } = renderWithRenderers(content, value);
    const failedAttempts = attempts;

    expect(failedAttempts).toBeGreaterThan(0);
    expect(container.querySelector('pre code')?.textContent).toBe('chart\n');

    rerender(
      <ChatRenderersContext.Provider value={value}>
        <MarkdownContent content={content + '\n\nMore text'} />
      </ChatRenderersContext.Provider>
    );
    expect(getByText('More text')).not.toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe('chart\n');
    expect(attempts).toBe(failedAttempts);

    rerender(
      <ChatRenderersContext.Provider value={renderers}>
        <MarkdownContent content={content + '\n\nMore text'} />
      </ChatRenderersContext.Provider>
    );
    expect(getByTestId('viz').textContent).toBe('chart');
    expect(container.querySelector('pre')).toBeNull();
  });

  test('retries when the language changes with the same source and component', () => {
    function LanguageBlock({ code, language }: ChatCodeBlockRendererProps) {
      if (language === 'pending') throw new Error('Language is still incomplete');
      return <div data-testid="language">{code}</div>;
    }
    const value = { codeBlocks: { pending: LanguageBlock, ready: LanguageBlock } };
    const { container, getByTestId, rerender } = renderWithRenderers('```pending\nchart\n```', value);

    expect(container.querySelector('pre code')?.textContent).toBe('chart\n');

    rerender(
      <ChatRenderersContext.Provider value={value}>
        <MarkdownContent content={'```ready\nchart\n```'} />
      </ChatRenderersContext.Provider>
    );
    expect(getByTestId('language').textContent).toBe('chart');
    expect(container.querySelector('pre')).toBeNull();
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
