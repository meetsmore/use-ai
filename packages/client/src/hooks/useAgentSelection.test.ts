import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useAgentSelection } from './useAgentSelection';
import type { AgentInfo } from '../types';
import type { UseAIClient } from '../client';

// Helper to create a mock UseAIClient
function createMockClient(onAgentsChangeFn?: (callback: (agents: AgentInfo[], defaultAgentId: string) => void) => () => void) {
  return {
    setAgent: mock(() => {}),
    onAgentsChange: onAgentsChangeFn || (() => () => {}),
  } as unknown as UseAIClient;
}

// Mock console.warn for testing warning logs
let consoleWarnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  consoleWarnSpy.mockRestore();
});

describe('useAgentSelection', () => {
  test('returns empty agents when not connected', () => {
    const clientRef = { current: createMockClient() };
    const { result } = renderHook(() =>
      useAgentSelection({ clientRef, connected: false })
    );

    expect(result.current.availableAgents).toEqual([]);
    expect(result.current.defaultAgent).toBeNull();
    expect(result.current.selectedAgent).toBeNull();
  });

  test('subscribes to agents when connected', () => {
    let capturedCallback: ((agents: AgentInfo[], defaultAgentId: string) => void) | null = null;
    const mockOnAgentsChange = mock((callback: (agents: AgentInfo[], defaultAgentId: string) => void) => {
      capturedCallback = callback;
      return () => {};
    });

    const clientRef = { current: createMockClient(mockOnAgentsChange) };
    const { result } = renderHook(() =>
      useAgentSelection({ clientRef, connected: true })
    );

    expect(mockOnAgentsChange).toHaveBeenCalled();

    // Simulate receiving agents from server
    act(() => {
      capturedCallback?.([
        { id: 'agent1', name: 'Agent 1' },
        { id: 'agent2', name: 'Agent 2' },
      ], 'agent1');
    });

    // all agents since visibleAgentIds is undefined.
    expect(result.current.availableAgents).toEqual([
      { id: 'agent1', name: 'Agent 1' },
      { id: 'agent2', name: 'Agent 2' },
    ]);
    expect(result.current.defaultAgent).toBe('agent1');
  });

  test('setAgent updates selectedAgent and calls client.setAgent', () => {
    const mockClient = createMockClient();
    const clientRef = { current: mockClient };
    const { result } = renderHook(() =>
      useAgentSelection({ clientRef, connected: true })
    );

    act(() => {
      result.current.setAgent('agent2');
    });

    expect(result.current.selectedAgent).toBe('agent2');
    expect(mockClient.setAgent).toHaveBeenCalledWith('agent2');
  });

  test('setAgent(null) resets to server default', () => {
    const mockClient = createMockClient();
    const clientRef = { current: mockClient };
    const { result } = renderHook(() =>
      useAgentSelection({ clientRef, connected: true })
    );

    act(() => {
      result.current.setAgent('agent2');
    });
    expect(result.current.selectedAgent).toBe('agent2');

    act(() => {
      result.current.setAgent(null);
    });
    expect(result.current.selectedAgent).toBeNull();
    expect(mockClient.setAgent).toHaveBeenCalledWith(null);
  });

  describe('visibleAgentIds filtering', () => {
    test('filters agents based on visibleAgentIds IDs', () => {
      let capturedCallback: ((agents: AgentInfo[], defaultAgentId: string) => void) | null = null;
      const mockOnAgentsChange = mock((callback: (agents: AgentInfo[], defaultAgentId: string) => void) => {
        capturedCallback = callback;
        return () => {};
      });

      const visibleAgentIds = ['agent1', 'agent3']; // agent3 doesn't exist on server

      const clientRef = { current: createMockClient(mockOnAgentsChange) };
      const { result } = renderHook(() =>
        useAgentSelection({ clientRef, connected: true, visibleAgentIds })
      );

      // Simulate receiving agents from server
      act(() => {
        capturedCallback?.([
          { id: 'agent1', name: 'Agent 1' },
          { id: 'agent2', name: 'Agent 2' }, // Not in config, should be filtered out
        ], 'agent1');
      });

      // Should only include agent1 (exists on server and in config)
      expect(result.current.availableAgents).toHaveLength(1);
      expect(result.current.availableAgents[0].id).toBe('agent1');
    });

    test('uses name and annotation from server', () => {
      let capturedCallback: ((agents: AgentInfo[], defaultAgentId: string) => void) | null = null;
      const mockOnAgentsChange = mock((callback: (agents: AgentInfo[], defaultAgentId: string) => void) => {
        capturedCallback = callback;
        return () => {};
      });

      const visibleAgentIds = ['agent1', 'agent2'];

      const clientRef = { current: createMockClient(mockOnAgentsChange) };
      const { result } = renderHook(() =>
        useAgentSelection({ clientRef, connected: true, visibleAgentIds })
      );

      // Simulate receiving agents from server with names and annotations
      act(() => {
        capturedCallback?.([
          { id: 'agent1', name: 'Quick Mode', annotation: 'Fast responses' },
          { id: 'agent2', name: 'Deep Thinking', annotation: 'Complex reasoning' },
        ], 'agent1');
      });

      // Should preserve server-provided names and annotations
      expect(result.current.availableAgents).toEqual([
        { id: 'agent1', name: 'Quick Mode', annotation: 'Fast responses' },
        { id: 'agent2', name: 'Deep Thinking', annotation: 'Complex reasoning' },
      ]);
    });

    test('preserves order from visibleAgentIds', () => {
      let capturedCallback: ((agents: AgentInfo[], defaultAgentId: string) => void) | null = null;
      const mockOnAgentsChange = mock((callback: (agents: AgentInfo[], defaultAgentId: string) => void) => {
        capturedCallback = callback;
        return () => {};
      });

      // Config has agent2 before agent1
      const visibleAgentIds = ['agent2', 'agent1'];

      const clientRef = { current: createMockClient(mockOnAgentsChange) };
      const { result } = renderHook(() =>
        useAgentSelection({ clientRef, connected: true, visibleAgentIds })
      );

      // Server sends in different order
      act(() => {
        capturedCallback?.([
          { id: 'agent1', name: 'Agent 1' },
          { id: 'agent2', name: 'Agent 2' },
        ], 'agent1');
      });

      // Should preserve config order
      expect(result.current.availableAgents[0].id).toBe('agent2');
      expect(result.current.availableAgents[1].id).toBe('agent1');
    });

    test('returns all server agents when visibleAgentIds is undefined', () => {
      let capturedCallback: ((agents: AgentInfo[], defaultAgentId: string) => void) | null = null;
      const mockOnAgentsChange = mock((callback: (agents: AgentInfo[], defaultAgentId: string) => void) => {
        capturedCallback = callback;
        return () => {};
      });

      const clientRef = { current: createMockClient(mockOnAgentsChange) };
      const { result } = renderHook(() =>
        useAgentSelection({ clientRef, connected: true, visibleAgentIds: undefined })
      );

      act(() => {
        capturedCallback?.([
          { id: 'agent1', name: 'Agent 1' },
          { id: 'agent2', name: 'Agent 2' },
        ], 'agent1');
      });

      // Should return all server agents when visibleAgentIds is undefined
      expect(result.current.availableAgents).toHaveLength(2);
      expect(result.current.availableAgents[0].id).toBe('agent1');
      expect(result.current.availableAgents[1].id).toBe('agent2');
      // Should NOT log a warning
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    test('falls back to default agent and logs warning when visibleAgentIds is empty array', () => {
      let capturedCallback: ((agents: AgentInfo[], defaultAgentId: string) => void) | null = null;
      const mockOnAgentsChange = mock((callback: (agents: AgentInfo[], defaultAgentId: string) => void) => {
        capturedCallback = callback;
        return () => {};
      });

      const clientRef = { current: createMockClient(mockOnAgentsChange) };
      const { result } = renderHook(() =>
        useAgentSelection({ clientRef, connected: true, visibleAgentIds: [] })
      );

      act(() => {
        capturedCallback?.([
          { id: 'agent1', name: 'Agent 1' },
          { id: 'agent2', name: 'Agent 2' },
        ], 'agent1');
      });

      // Should only return the default agent
      expect(result.current.availableAgents).toHaveLength(1);
      expect(result.current.availableAgents[0].id).toBe('agent1');
      // Should log a warning
      expect(consoleWarnSpy).toHaveBeenCalledWith('[AgentSelection] visibleAgentIds is empty array, falling back to default agent');
    });

    test('falls back to default agent and logs warning when no config IDs match server agents', () => {
      let capturedCallback: ((agents: AgentInfo[], defaultAgentId: string) => void) | null = null;
      const mockOnAgentsChange = mock((callback: (agents: AgentInfo[], defaultAgentId: string) => void) => {
        capturedCallback = callback;
        return () => {};
      });

      const visibleAgentIds = ['nonexistent1', 'nonexistent2'];

      const clientRef = { current: createMockClient(mockOnAgentsChange) };
      const { result } = renderHook(() =>
        useAgentSelection({ clientRef, connected: true, visibleAgentIds })
      );

      act(() => {
        capturedCallback?.([
          { id: 'agent1', name: 'Agent 1' },
          { id: 'agent2', name: 'Agent 2' },
        ], 'agent1');
      });

      // Should fall back to default agent
      expect(result.current.availableAgents).toHaveLength(1);
      expect(result.current.availableAgents[0].id).toBe('agent1');
      expect(result.current.availableAgents[0].name).toBe('Agent 1');
      // Should log a warning
      expect(consoleWarnSpy).toHaveBeenCalledWith('[AgentSelection] No agents in visibleAgentIds match server agents, falling back to default agent');
    });

    test('falls back to all agents and logs warning if default agent not found when visibleAgentIds is empty array', () => {
      let capturedCallback: ((agents: AgentInfo[], defaultAgentId: string) => void) | null = null;
      const mockOnAgentsChange = mock((callback: (agents: AgentInfo[], defaultAgentId: string) => void) => {
        capturedCallback = callback;
        return () => {};
      });

      const clientRef = { current: createMockClient(mockOnAgentsChange) };
      const { result } = renderHook(() =>
        useAgentSelection({ clientRef, connected: true, visibleAgentIds: [] })
      );

      act(() => {
        capturedCallback?.([
          { id: 'agent1', name: 'Agent 1' },
          { id: 'agent2', name: 'Agent 2' },
        ], 'nonexistent-default'); // Default agent doesn't exist in server agents
      });

      // Should fall back to all server agents (since default agent doesn't exist)
      expect(result.current.availableAgents).toHaveLength(2);
      // Should log a warning about empty array
      expect(consoleWarnSpy).toHaveBeenCalledWith('[AgentSelection] visibleAgentIds is empty array, falling back to default agent');
    });
  });

  describe('auto-selection behavior', () => {
    test('auto-selects single non-default agent from visibleAgentIds', () => {
      let capturedCallback: ((agents: AgentInfo[], defaultAgentId: string) => void) | null = null;
      const mockOnAgentsChange = mock((callback: (agents: AgentInfo[], defaultAgentId: string) => void) => {
        capturedCallback = callback;
        return () => {};
      });

      // Only configure agent2, which is NOT the server default (agent1)
      const visibleAgentIds = ['agent2'];

      const mockClient = createMockClient(mockOnAgentsChange);
      const clientRef = { current: mockClient };
      const { result } = renderHook(() =>
        useAgentSelection({ clientRef, connected: true, visibleAgentIds })
      );

      // Simulate receiving agents from server with agent1 as default
      act(() => {
        capturedCallback?.([
          { id: 'agent1', name: 'Agent 1' },
          { id: 'agent2', name: 'Agent 2' },
        ], 'agent1');
      });

      // Should auto-select agent2 since it's the only configured agent and default is not available
      expect(result.current.availableAgents).toHaveLength(1);
      expect(result.current.availableAgents[0].id).toBe('agent2');
      expect(result.current.selectedAgent).toBe('agent2');
      expect(mockClient.setAgent).toHaveBeenCalledWith('agent2');
    });

    test('does not auto-select when single agent matches server default', () => {
      let capturedCallback: ((agents: AgentInfo[], defaultAgentId: string) => void) | null = null;
      const mockOnAgentsChange = mock((callback: (agents: AgentInfo[], defaultAgentId: string) => void) => {
        capturedCallback = callback;
        return () => {};
      });

      // Only configure agent1, which IS the server default
      const visibleAgentIds = ['agent1'];

      const mockClient = createMockClient(mockOnAgentsChange);
      const clientRef = { current: mockClient };
      const { result } = renderHook(() =>
        useAgentSelection({ clientRef, connected: true, visibleAgentIds })
      );

      // Simulate receiving agents from server with agent1 as default
      act(() => {
        capturedCallback?.([
          { id: 'agent1', name: 'Agent 1' },
          { id: 'agent2', name: 'Agent 2' },
        ], 'agent1');
      });

      // Should NOT auto-select since the single agent matches server default
      expect(result.current.availableAgents).toHaveLength(1);
      expect(result.current.availableAgents[0].id).toBe('agent1');
      expect(result.current.selectedAgent).toBeNull();
      // setAgent should not be called for auto-selection
      expect(mockClient.setAgent).not.toHaveBeenCalled();
    });

    test('uses default agent when available in multi-agent config', () => {
      let capturedCallback: ((agents: AgentInfo[], defaultAgentId: string) => void) | null = null;
      const mockOnAgentsChange = mock((callback: (agents: AgentInfo[], defaultAgentId: string) => void) => {
        capturedCallback = callback;
        return () => {};
      });

      // Configure multiple agents including the default agent
      const visibleAgentIds = ['agent2', 'agent1']; // agent1 is the server default

      const mockClient = createMockClient(mockOnAgentsChange);
      const clientRef = { current: mockClient };
      const { result } = renderHook(() =>
        useAgentSelection({ clientRef, connected: true, visibleAgentIds })
      );

      // Simulate receiving agents from server
      act(() => {
        capturedCallback?.([
          { id: 'agent1', name: 'Agent 1' },
          { id: 'agent2', name: 'Agent 2' },
        ], 'agent1');
      });

      // Should NOT auto-select since default agent is available in config
      expect(result.current.availableAgents).toHaveLength(2);
      expect(result.current.selectedAgent).toBeNull();
      expect(mockClient.setAgent).not.toHaveBeenCalled();
    });

    test('auto-selects first agent when default is not in config', () => {
      let capturedCallback: ((agents: AgentInfo[], defaultAgentId: string) => void) | null = null;
      const mockOnAgentsChange = mock((callback: (agents: AgentInfo[], defaultAgentId: string) => void) => {
        capturedCallback = callback;
        return () => {};
      });

      // Configure multiple agents (agent2 is first, agent3 is second) - default agent1 not included
      const visibleAgentIds = ['agent2', 'agent3'];

      const mockClient = createMockClient(mockOnAgentsChange);
      const clientRef = { current: mockClient };
      const { result } = renderHook(() =>
        useAgentSelection({ clientRef, connected: true, visibleAgentIds })
      );

      // Simulate receiving agents from server
      act(() => {
        capturedCallback?.([
          { id: 'agent1', name: 'Agent 1' },
          { id: 'agent2', name: 'Agent 2' },
          { id: 'agent3', name: 'Agent 3' },
        ], 'agent1');
      });

      // Should auto-select the first agent (agent2) since default is not in config
      expect(result.current.availableAgents).toHaveLength(2);
      expect(result.current.selectedAgent).toBe('agent2');
      expect(mockClient.setAgent).toHaveBeenCalledWith('agent2');
    });

    test('does not auto-select when user has already selected an agent', () => {
      let capturedCallback: ((agents: AgentInfo[], defaultAgentId: string) => void) | null = null;
      const mockOnAgentsChange = mock((callback: (agents: AgentInfo[], defaultAgentId: string) => void) => {
        capturedCallback = callback;
        return () => {};
      });

      const visibleAgentIds = ['agent2'];

      const mockClient = createMockClient(mockOnAgentsChange);
      const clientRef = { current: mockClient };
      const { result } = renderHook(() =>
        useAgentSelection({ clientRef, connected: true, visibleAgentIds })
      );

      // User manually selects an agent first
      act(() => {
        result.current.setAgent('agent2');
      });

      // Clear mock to track only subsequent calls
      mockClient.setAgent.mockClear();

      // Simulate receiving agents from server
      act(() => {
        capturedCallback?.([
          { id: 'agent1', name: 'Agent 1' },
          { id: 'agent2', name: 'Agent 2' },
        ], 'agent1');
      });

      // Should NOT auto-select again since user already selected
      expect(result.current.selectedAgent).toBe('agent2');
      expect(mockClient.setAgent).not.toHaveBeenCalled();
    });
  });
});
