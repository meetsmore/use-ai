import { describe, test, expect } from 'bun:test';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { Reasoning } from './Reasoning';
import { defaultTheme } from '../theme/theme';
import { defaultStrings } from '../theme/strings';

describe('Reasoning', () => {
  const renderOpened = (texts: string[]) => {
    const { getByTestId } = render(
      <Reasoning
        reasoningParts={texts.map(text => ({ text }))}
        theme={defaultTheme}
        strings={defaultStrings}
      />,
    );
    fireEvent.click(getByTestId('thinking-toggle'));
    return getByTestId('thinking-content').textContent;
  };

  test('separates parts with exactly one blank line even when a part ends with blank lines', () => {
    const shown = renderOpened(['First step.\n\n', 'Second step.\n\n']);

    expect(shown).toBe('First step.\n\nSecond step.');
  });

  test('drops parts that are empty or whitespace only', () => {
    const shown = renderOpened(['First step.', '', '\n\n', 'Second step.']);

    expect(shown).toBe('First step.\n\nSecond step.');
  });
});
