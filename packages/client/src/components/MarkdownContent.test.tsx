import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render } from '@testing-library/react';
import { MarkdownContent } from './MarkdownContent';

/**
 * Streaming appends to `content` many times per second. If a re-render
 * recreates the DOM instead of updating it, the browser drops whatever the
 * user has selected, so they cannot copy an answer while it is being written.
 * These tests pin the DOM nodes of already-rendered text down across updates.
 */
describe('MarkdownContent during streaming', () => {
  const stream = (steps: string[]) => {
    const { container, rerender } = render(<MarkdownContent content={steps[0]} />);
    const firstBlock = container.firstElementChild;
    const firstText = firstBlock?.firstChild;
    // Without these the node-identity assertions below hold vacuously when
    // nothing renders at all (null === null).
    expect(firstBlock).not.toBeNull();
    expect(firstText).not.toBeNull();

    let previousText = container.textContent;
    for (const step of steps.slice(1)) {
      rerender(<MarkdownContent content={step} />);
      expect(container.firstElementChild).toBe(firstBlock!);
      expect(container.firstElementChild?.firstChild).toBe(firstText!);
      // Node identity alone is also satisfied by a component that stops
      // updating entirely, so each step has to visibly change the text.
      expect(container.textContent).not.toBe(previousText);
      previousText = container.textContent;
    }

    return container;
  };

  test('keeps the growing paragraph node while text is appended to it', () => {
    const container = stream(['Hello wo', 'Hello world', 'Hello world and more']);

    expect(container.textContent).toBe('Hello world and more');
  });

  test('keeps earlier paragraphs when a new paragraph starts', () => {
    const container = stream([
      'First paragraph.',
      'First paragraph.\n\nSec',
      'First paragraph.\n\nSecond paragraph.',
    ]);

    expect([...container.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'First paragraph.',
      'Second paragraph.',
    ]);
  });

  test('keeps earlier text when a list is being written', () => {
    const container = stream([
      'Intro text.',
      'Intro text.\n\n- item on',
      'Intro text.\n\n- item one\n- item t',
      'Intro text.\n\n- item one\n- item two',
    ]);

    expect([...container.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'item one',
      'item two',
    ]);
  });

  test('keeps earlier text when a table is being written', () => {
    const container = stream([
      'Intro text.',
      'Intro text.\n\n| a | b |',
      'Intro text.\n\n| a | b |\n| - | - |',
      'Intro text.\n\n| a | b |\n| - | - |\n| 1 | 2 |',
    ]);

    expect(container.querySelector('table')).not.toBeNull();
  });

  test('keeps earlier text when inline markdown completes mid-stream', () => {
    const container = stream(['Hello **bo', 'Hello **bold', 'Hello **bold**', 'Hello **bold** tail']);

    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });
});
