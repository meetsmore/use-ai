/**
 * Test: systemPrompt loss on page navigation
 *
 * Production bug: When page navigation and systemPrompt change happen in the
 * same batched render, the unmounting component's cleanup sends stale/missing
 * systemPrompt to the server via updateState().
 *
 * See: docs/bugs/systemPrompt-loss-on-navigation.md
 */
import { describe, it, expect } from 'bun:test';
import { render, act } from '@testing-library/react';
import React from 'react';
import { usePromptState } from '../src/hooks/usePromptState';
import { useAI } from '../src/useAI';
import {
  __UseAIContext,
  type UseAIContextValue,
} from '../src/providers/useAIProvider';

describe('systemPrompt loss on page navigation', () => {
  it('should not lose systemPrompt when useAI unmounts during systemPrompt change', () => {
    const allStates: any[] = [];
    const mockClient = {
      updateState: (state: any) => allStates.push(state),
    };
    const clientRef = { current: mockClient } as any;

    const PageA = () => {
      useAI({ prompt: 'Page A content' });
      return null;
    };

    const App = ({
      systemPrompt,
      showChild,
    }: {
      systemPrompt: string | undefined;
      showChild: boolean;
    }) => {
      const promptState = usePromptState({
        systemPrompt,
        clientRef,
        connected: true,
      });

      const contextValue: UseAIContextValue = {
        serverUrl: 'ws://localhost:8081',
        connected: true,
        client: null,
        tools: {
          register: () => {},
          unregister: () => {},
        },
        prompts: {
          update: promptState.updatePrompt,
          registerWaiter: promptState.registerWaiter,
          unregisterWaiter: promptState.unregisterWaiter,
        },
        chat: {} as any,
        agents: {} as any,
        commands: {} as any,
      };

      return (
        <__UseAIContext.Provider value={contextValue}>
          {showChild ? <PageA /> : null}
        </__UseAIContext.Provider>
      );
    };

    // Initial: systemPrompt undefined, Page A mounted
    const { rerender } = render(
      <App systemPrompt={undefined} showChild={true} />
    );

    const stateCountBefore = allStates.length;

    // Simulate: user data loads + navigate away in same render
    act(() => {
      rerender(
        <App
          systemPrompt="test system prompt"
          showChild={false}
        />
      );
    });

    // Every state sent after the change must include systemPrompt
    const statesAfter = allStates.slice(stateCountBefore);
    expect(statesAfter.length).toBeGreaterThan(0);

    for (const state of statesAfter) {
      expect(state).not.toBeNull();
      if (state?.context) {
        expect(state.context).toContain('test system prompt');
      }
    }
  });
});
