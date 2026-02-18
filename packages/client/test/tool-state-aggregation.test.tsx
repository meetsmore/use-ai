import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { UseAIProvider } from '../src/providers/useAIProvider';
import { useAI } from '../src/useAI';
import { defineTool } from '../src/defineTool';
import { z } from 'zod';
import {
  setupMockWebSocket,
  restoreMockWebSocket,
  simulateToolCall,
  findSentMessage,
} from './integration-test-utils';

const addTodo = defineTool(
  'Add a todo item',
  z.object({ text: z.string() }),
  (input) => ({ success: true, text: input.text })
);

describe('tool_result sends aggregated state from all hooks', () => {
  beforeEach(() => {
    setupMockWebSocket();
  });

  afterEach(() => {
    restoreMockWebSocket();
  });

  it('should include prompts from all useAI hooks in tool_result state, not just the owning hook', async () => {
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <UseAIProvider serverUrl="ws://localhost:8081" systemPrompt="You are a helpful assistant.">
          <ComponentA />
          <ComponentB />
          {children}
        </UseAIProvider>
      );
    }

    // ComponentA owns the addTodo tool and has its own prompt
    const stableToolsA = { addTodo };
    function ComponentA() {
      useAI({
        tools: stableToolsA,
        prompt: 'Todo List: ["buy milk"]',
        invisible: true,
      });
      return null;
    }

    // ComponentB has a different prompt but no tools
    function ComponentB() {
      useAI({
        prompt: 'Navigation: current page is /home',
        invisible: true,
      });
      return null;
    }

    // Render a dummy hook to get connection status
    const { result } = renderHook(
      () => useAI({ invisible: true }),
      { wrapper: Wrapper }
    );

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Simulate a tool call on addTodo (owned by ComponentA)
    simulateToolCall('tool-call-1', 'addTodo', { text: 'buy eggs' });

    // Wait for the tool_result to be sent
    await waitFor(() => {
      const toolResult = findSentMessage('tool_result');
      expect(toolResult).toBeDefined();
    });

    const toolResult = findSentMessage('tool_result');
    const state = toolResult.data.forwardedProps?.state;

    expect(state).toBeDefined();
    expect(state.context).toBeDefined();

    // The state should contain prompts from BOTH hooks, not just the owning one
    expect(state.context).toContain('Todo List');
    expect(state.context).toContain('Navigation: current page is /home');

    // It should also include the system prompt
    expect(state.context).toContain('You are a helpful assistant.');
  });
});
