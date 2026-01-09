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

// Define tools outside the tests to avoid recreating them on every render
const testTool = defineTool(
  'Test tool',
  z.object({ value: z.string() }),
  (input) => ({ success: true, value: input.value })
);

const errorTool = defineTool(
  'Error tool',
  z.object({ value: z.string() }),
  (input) => ({ success: false, error: 'Test error' })
);

describe('Invisible components', () => {
  beforeEach(() => {
    setupMockWebSocket();
  });

  afterEach(() => {
    restoreMockWebSocket();
  });

  it('should not wait for render when invisible: true', async () => {
    // Wrapper component to provide context
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <UseAIProvider serverUrl="ws://localhost:8081">
          {children}
        </UseAIProvider>
      );
    }

    // Stable tools object to prevent re-registration
    const stableTools = { testTool };

    // Render hook with invisible: true
    const { result } = renderHook(
      () => {
        const ai = useAI({
          tools: stableTools,
          invisible: true,
        });
        return ai;
      },
      { wrapper: Wrapper }
    );

    // Wait for connection
    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Simulate a tool call from server
    const toolCallId = 'test-call-123';
    simulateToolCall(toolCallId, 'testTool', { value: 'test' });

    // Wait for tool result to be sent
    await waitFor(() => {
      const toolResult = findSentMessage('tool_result');
      expect(toolResult).toBeDefined();
    });

    // Verify the tool result was sent immediately
    const toolResult = findSentMessage('tool_result');
    expect(toolResult).toBeDefined();
    expect(toolResult.data.toolCallId).toBe(toolCallId);
  });

  it('should wait for render when invisible: false (default)', async () => {
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <UseAIProvider serverUrl="ws://localhost:8081">
          {children}
        </UseAIProvider>
      );
    }

    // Stable tools object to prevent re-registration
    const stableTools = { testTool };

    // Render hook without invisible flag
    const { result, rerender } = renderHook(
      () => {
        const ai = useAI({
          tools: stableTools,
          // invisible: false (default)
        });
        return ai;
      },
      { wrapper: Wrapper }
    );

    // Wait for connection
    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Simulate a tool call
    const toolCallId = 'test-call-456';
    simulateToolCall(toolCallId, 'testTool', { value: 'test' });

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));

    // At this point, the tool has executed but is waiting for render
    // We need to trigger a re-render
    rerender();

    // Now the tool result should be sent
    await waitFor(() => {
      const toolResult = findSentMessage('tool_result');
      expect(toolResult).toBeDefined();
    });
  });

  it('should not wait for render on error results even without invisible flag', async () => {
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <UseAIProvider serverUrl="ws://localhost:8081">
          {children}
        </UseAIProvider>
      );
    }

    // Stable tools object to prevent re-registration
    const stableTools = { errorTool };

    const { result } = renderHook(
      () => {
        const ai = useAI({
          tools: stableTools,
          // invisible: false (default) - but error results skip wait
        });
        return ai;
      },
      { wrapper: Wrapper }
    );

    // Wait for connection
    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Simulate a tool call
    const toolCallId = 'test-call-789';
    simulateToolCall(toolCallId, 'errorTool', { value: 'test' });

    // Error result should be sent immediately without waiting for render
    await waitFor(() => {
      const toolResult = findSentMessage('tool_result');
      expect(toolResult).toBeDefined();
    }, { timeout: 5000 });
  });
});
