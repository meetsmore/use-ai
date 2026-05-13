import { describe, test, expect } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { useStableSystemPrompts } from './useStableSystemPrompts';
import type { SystemPromptEntry } from '../types';

describe('useStableSystemPrompts - Unit', () => {
  test('returns undefined for undefined input', () => {
    const { result } = renderHook(() => useStableSystemPrompts(undefined));
    expect(result.current).toBeUndefined();
  });

  test('returns undefined for empty array', () => {
    const { result } = renderHook(() => useStableSystemPrompts([]));
    expect(result.current).toBeUndefined();
  });

  test('returns the same reference when contents are unchanged across renders (inline arrays)', () => {
    // Simulate inline-defined arrays: a fresh array literal every render with identical contents.
    const { result, rerender } = renderHook(() =>
      useStableSystemPrompts([
        {
          content: 'You are a helpful assistant.',
          providerOptions: {
            anthropic: { cacheControl: { type: 'ephemeral', ttl: '5m' } },
          },
        },
      ]),
    );

    const firstRef = result.current;
    expect(firstRef).toBeDefined();
    expect(firstRef).toHaveLength(1);

    rerender();
    expect(result.current).toBe(firstRef);

    rerender();
    expect(result.current).toBe(firstRef);
  });

  test('returns a new reference when contents actually change', () => {
    const prompts1: SystemPromptEntry[] = [{ content: 'first' }];
    const prompts2: SystemPromptEntry[] = [{ content: 'first' }, { content: 'second' }];

    const { result, rerender } = renderHook(
      ({ prompts }: { prompts: SystemPromptEntry[] }) => useStableSystemPrompts(prompts),
      { initialProps: { prompts: prompts1 } },
    );

    const firstRef = result.current;
    expect(firstRef).toBeDefined();

    // Same contents but new array literal -> reference stays stable.
    rerender({ prompts: [{ content: 'first' }] });
    expect(result.current).toBe(firstRef);

    // Contents change -> new reference.
    rerender({ prompts: prompts2 });
    expect(result.current).not.toBe(firstRef);
    expect(result.current).toHaveLength(2);
  });

  test('detects content changes (different content string)', () => {
    const { result, rerender } = renderHook(
      ({ content }: { content: string }) =>
        useStableSystemPrompts([{ content }]),
      { initialProps: { content: 'You are helpful.' } },
    );

    const firstRef = result.current;
    expect(firstRef![0].content).toBe('You are helpful.');

    rerender({ content: 'You are concise.' });
    expect(result.current).not.toBe(firstRef);
    expect(result.current![0].content).toBe('You are concise.');
  });

  test('detects providerOptions changes', () => {
    const { result, rerender } = renderHook(
      ({ ttl }: { ttl: string }) =>
        useStableSystemPrompts([
          {
            content: 'hello',
            providerOptions: {
              anthropic: { cacheControl: { type: 'ephemeral', ttl } },
            },
          },
        ]),
      { initialProps: { ttl: '5m' } },
    );

    const firstRef = result.current;
    expect(
      (firstRef![0].providerOptions as { anthropic: { cacheControl: { ttl: string } } }).anthropic
        .cacheControl.ttl,
    ).toBe('5m');

    // Same providerOptions -> stable reference.
    rerender({ ttl: '5m' });
    expect(result.current).toBe(firstRef);

    // Changed providerOptions -> new reference.
    rerender({ ttl: '1h' });
    expect(result.current).not.toBe(firstRef);
    expect(
      (result.current![0].providerOptions as { anthropic: { cacheControl: { ttl: string } } })
        .anthropic.cacheControl.ttl,
    ).toBe('1h');
  });

  test('handles transition from undefined to defined', () => {
    const { result, rerender } = renderHook(
      ({ prompts }: { prompts: SystemPromptEntry[] | undefined }) =>
        useStableSystemPrompts(prompts),
      { initialProps: { prompts: undefined as SystemPromptEntry[] | undefined } },
    );

    expect(result.current).toBeUndefined();

    rerender({ prompts: [{ content: 'hi' }] });
    expect(result.current).toBeDefined();
    expect(result.current).toHaveLength(1);
  });

  test('handles transition from defined to undefined', () => {
    const { result, rerender } = renderHook(
      ({ prompts }: { prompts: SystemPromptEntry[] | undefined }) =>
        useStableSystemPrompts(prompts),
      {
        initialProps: {
          prompts: [{ content: 'hi' }] as SystemPromptEntry[] | undefined,
        },
      },
    );

    expect(result.current).toBeDefined();

    rerender({ prompts: undefined });
    expect(result.current).toBeUndefined();
  });

  test('handles transition from defined to empty array (treated as undefined)', () => {
    const { result, rerender } = renderHook(
      ({ prompts }: { prompts: SystemPromptEntry[] }) => useStableSystemPrompts(prompts),
      { initialProps: { prompts: [{ content: 'hi' }] as SystemPromptEntry[] } },
    );

    expect(result.current).toBeDefined();

    rerender({ prompts: [] });
    expect(result.current).toBeUndefined();
  });

  test('reference stays stable across many rapid rerenders with identical inline arrays', () => {
    const { result, rerender } = renderHook(() =>
      useStableSystemPrompts([
        { content: 'Stable content' },
        { content: 'Some context' },
      ]),
    );

    const firstRef = result.current;
    expect(firstRef).toBeDefined();

    for (let i = 0; i < 50; i++) {
      rerender();
      expect(result.current).toBe(firstRef);
    }
  });
});
