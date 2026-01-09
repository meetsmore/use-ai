import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { UseAIProvider } from '../src/providers/useAIProvider';
import { useAI } from '../src/useAI';
import { defineTool } from '../src/defineTool';
import { z } from 'zod';
import {
  setupMockWebSocket,
  restoreMockWebSocket,
  useStableTools,
} from './integration-test-utils';

// Define tools outside the tests to avoid recreating them on every render
const testTool = defineTool(
  'Test tool',
  z.object({ value: z.string() }),
  (input) => ({ success: true, value: input.value })
);

describe('Headless Mode (Disabled UI)', () => {
  beforeEach(() => {
    setupMockWebSocket();
  });

  afterEach(() => {
    restoreMockWebSocket();
  });

  it('should not render UI when CustomButton and CustomChat are null', () => {
    function TestComponent() {
      // Use stable tools to prevent infinite re-renders
      const tools = useStableTools({ testTool });

      useAI({
        tools,
        prompt: 'Test component',
      });
      return <div>Test App</div>;
    }

    const { getByText, queryByTestId } = render(
      <UseAIProvider
        serverUrl="ws://localhost:8081"
        CustomButton={null}
        CustomChat={null}
      >
        <TestComponent />
      </UseAIProvider>
    );

    // Verify the app content is rendered
    expect(getByText('Test App')).toBeDefined();

    // Verify the floating button is NOT rendered
    // Default button has data-testid="ai-button"
    expect(queryByTestId('ai-button')).toBeNull();

    // Verify the chat panel is NOT rendered
    // Default chat has data-testid="chat-input"
    expect(queryByTestId('chat-input')).toBeNull();
  });

  it('should render default UI when CustomButton and CustomChat are undefined', () => {
    function TestComponent() {
      // Use stable tools to prevent infinite re-renders
      const tools = useStableTools({ testTool });

      useAI({
        tools,
        prompt: 'Test component',
      });
      return <div>Test App</div>;
    }

    const { getByText, getByTestId } = render(
      <UseAIProvider serverUrl="ws://localhost:8081">
        <TestComponent />
      </UseAIProvider>
    );

    // Verify the app content is rendered
    expect(getByText('Test App')).toBeDefined();

    // Verify the floating button IS rendered
    expect(getByTestId('ai-button')).toBeDefined();

    // Chat panel is closed by default, so it won't have visible elements
    // but we can check that the provider is working
  });

  it('should not render UI when only CustomButton is null', () => {
    function TestComponent() {
      // Use stable tools to prevent infinite re-renders
      const tools = useStableTools({ testTool });

      useAI({
        tools,
        prompt: 'Test component',
      });
      return <div>Test App</div>;
    }

    const { getByText, queryByTestId } = render(
      <UseAIProvider
        serverUrl="ws://localhost:8081"
        CustomButton={null}
      >
        <TestComponent />
      </UseAIProvider>
    );

    // Verify the app content is rendered
    expect(getByText('Test App')).toBeDefined();

    // When either component is null, both should be hidden
    expect(queryByTestId('ai-button')).toBeNull();
    expect(queryByTestId('chat-input')).toBeNull();
  });

  it('should not render UI when only CustomChat is null', () => {
    function TestComponent() {
      // Use stable tools to prevent infinite re-renders
      const tools = useStableTools({ testTool });

      useAI({
        tools,
        prompt: 'Test component',
      });
      return <div>Test App</div>;
    }

    const { getByText, queryByTestId } = render(
      <UseAIProvider
        serverUrl="ws://localhost:8081"
        CustomChat={null}
      >
        <TestComponent />
      </UseAIProvider>
    );

    // Verify the app content is rendered
    expect(getByText('Test App')).toBeDefined();

    // When either component is null, both should be hidden
    expect(queryByTestId('ai-button')).toBeNull();
    expect(queryByTestId('chat-input')).toBeNull();
  });

  it('should still register tools and maintain functionality in headless mode', async () => {
    let toolExecutionCount = 0;

    const countingTool = defineTool(
      'Counting tool',
      z.object({ value: z.string() }),
      (input) => {
        toolExecutionCount++;
        return { success: true, value: input.value, count: toolExecutionCount };
      }
    );

    function TestComponent() {
      // Use stable tools to prevent infinite re-renders
      const tools = useStableTools({ countingTool });

      const { connected } = useAI({
        tools,
        prompt: 'Test component',
      });
      return <div>Connected: {connected ? 'yes' : 'no'}</div>;
    }

    const { getByText, queryByTestId } = render(
      <UseAIProvider
        serverUrl="ws://localhost:8081"
        CustomButton={null}
        CustomChat={null}
      >
        <TestComponent />
      </UseAIProvider>
    );

    // Wait for connection to establish
    await waitFor(() => {
      expect(getByText(/Connected: yes/)).toBeDefined();
    });

    // UI is not rendered
    expect(queryByTestId('ai-button')).toBeNull();
  });
});
