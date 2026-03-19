import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { renderHook, act, waitFor } from '@testing-library/react';
import React, { ReactNode, useState } from 'react';
import { UseAIProvider, __UseAIContext } from '../src/providers/useAIProvider';
import { useAI } from '../src/useAI';
import { defineTool } from '../src/defineTool';
import { z } from 'zod';
import {
  setupMockWebSocket,
  restoreMockWebSocket,
  findSentMessage,
  getSentMessages,
} from './integration-test-utils';

const toolA = defineTool(
  'Tool registered on page A',
  z.object({ value: z.string() }),
  (input) => ({ success: true, value: input.value })
);

const toolB = defineTool(
  'Tool registered on page B',
  z.object({ id: z.string() }),
  (input) => ({ success: true, id: input.id })
);

describe('tool cleanup on navigation (unmount)', () => {
  beforeEach(() => {
    setupMockWebSocket();
  });

  afterEach(() => {
    restoreMockWebSocket();
  });

  it('should clear stale tools from client when all tool-registering components unmount', async () => {
    let setShowToolComponent: (show: boolean) => void;
    let capturedClient: any = null;

    function PageSimulator({ children }: { children: ReactNode }) {
      const [showToolComponent, _setShowToolComponent] = useState(true);
      setShowToolComponent = _setShowToolComponent;

      return (
        <UseAIProvider serverUrl="ws://localhost:8081">
          {showToolComponent && <ComponentWithTools />}
          <ClientCapture />
          {children}
        </UseAIProvider>
      );
    }

    function ClientCapture() {
      const ctx = React.useContext(__UseAIContext);
      if (ctx?.client) capturedClient = ctx.client;
      return null;
    }

    const stableTools = { toolA };
    function ComponentWithTools() {
      useAI({
        tools: stableTools,
        prompt: 'Page A context',
        invisible: true,
      });
      return null;
    }

    const { result } = renderHook(
      () => useAI({ invisible: true }),
      { wrapper: PageSimulator }
    );

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Verify tools are registered before unmount
    expect(capturedClient).not.toBeNull();
    capturedClient.sendPrompt('test message before unmount');

    await waitFor(() => {
      const runAgent = findSentMessage('run_agent');
      expect(runAgent).toBeDefined();
    });

    const runAgentBefore = findSentMessage('run_agent');
    expect(runAgentBefore.data.tools.length).toBeGreaterThan(0);
    expect(runAgentBefore.data.tools.some((t: any) => t.name === 'toolA')).toBe(true);

    // Clear sent messages for next assertion
    getSentMessages().length = 0;

    // Simulate navigation: unmount the component with tools
    await act(async () => {
      setShowToolComponent!(false);
    });

    // Send a prompt after unmount — stale tools should NOT be included
    capturedClient.sendPrompt('test message after unmount');

    await waitFor(() => {
      const runAgent = findSentMessage('run_agent');
      expect(runAgent).toBeDefined();
    });

    const runAgentAfter = findSentMessage('run_agent');
    expect(runAgentAfter.data.tools.length).toBe(0);
  });

  it('should re-register new tools when navigating from page A to page B', async () => {
    let setPage: (page: 'A' | 'B') => void;
    let capturedClient: any = null;

    function PageSimulator({ children }: { children: ReactNode }) {
      const [page, _setPage] = useState<'A' | 'B'>('A');
      setPage = _setPage;

      return (
        <UseAIProvider serverUrl="ws://localhost:8081">
          {page === 'A' && <PageAComponent />}
          {page === 'B' && <PageBComponent />}
          <ClientCapture />
          {children}
        </UseAIProvider>
      );
    }

    function ClientCapture() {
      const ctx = React.useContext(__UseAIContext);
      if (ctx?.client) capturedClient = ctx.client;
      return null;
    }

    const pageATools = { toolA };
    function PageAComponent() {
      useAI({
        tools: pageATools,
        prompt: 'Page A context',
        invisible: true,
      });
      return null;
    }

    const pageBTools = { toolB };
    function PageBComponent() {
      useAI({
        tools: pageBTools,
        prompt: 'Page B context',
        invisible: true,
      });
      return null;
    }

    const { result } = renderHook(
      () => useAI({ invisible: true }),
      { wrapper: PageSimulator }
    );

    await waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    // Verify Page A's tools are registered
    capturedClient.sendPrompt('test on page A');

    await waitFor(() => {
      const runAgent = findSentMessage('run_agent');
      expect(runAgent).toBeDefined();
    });

    const runAgentPageA = findSentMessage('run_agent');
    expect(runAgentPageA.data.tools.some((t: any) => t.name === 'toolA')).toBe(true);
    expect(runAgentPageA.data.tools.some((t: any) => t.name === 'toolB')).toBe(false);

    getSentMessages().length = 0;

    // Navigate from Page A to Page B
    await act(async () => {
      setPage!('B');
    });

    // Verify Page B's tools are registered, not Page A's
    capturedClient.sendPrompt('test on page B');

    await waitFor(() => {
      const runAgent = findSentMessage('run_agent');
      expect(runAgent).toBeDefined();
    });

    const runAgentPageB = findSentMessage('run_agent');
    expect(runAgentPageB.data.tools.some((t: any) => t.name === 'toolB')).toBe(true);
    expect(runAgentPageB.data.tools.some((t: any) => t.name === 'toolA')).toBe(false);
  });
});
