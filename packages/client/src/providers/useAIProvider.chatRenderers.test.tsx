import React from 'react';
import { describe, test, expect } from 'bun:test';
import { render } from '@testing-library/react';
import { installSocketIOMock } from '../../test/socketIOMock';
import type { ChatCodeBlockRendererProps } from '../components/chatRenderers';

installSocketIOMock();

const { UseAIProvider } = await import('./useAIProvider');
const { MarkdownContent } = await import('../components/MarkdownContent');

function VizBlock({ code }: ChatCodeBlockRendererProps) {
  return <div data-testid="viz">{code}</div>;
}

const codeBlocks = { viz: VizBlock };

describe('UseAIProvider chatRenderers', () => {
  test('reaches answer text rendered anywhere under the provider', () => {
    const { getByTestId } = render(
      <UseAIProvider serverUrl="http://localhost:8081" renderChat={false} chatRenderers={{ codeBlocks }}>
        <MarkdownContent content={'```viz\nchart\n```'} />
      </UseAIProvider>
    );

    expect(getByTestId('viz').textContent).toBe('chart');
  });

  test('keeps the built-in code block when chatRenderers is not set', () => {
    const { container, queryByTestId } = render(
      <UseAIProvider serverUrl="http://localhost:8081" renderChat={false}>
        <MarkdownContent content={'```viz\nchart\n```'} />
      </UseAIProvider>
    );

    expect(queryByTestId('viz')).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toBe('chart\n');
  });
});
