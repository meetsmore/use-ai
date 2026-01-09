import { useState, useCallback, useEffect, useMemo } from 'react';
import type { AgentInfo } from '../types';
import type { UseAIClient } from '../client';

export interface UseAgentSelectionOptions {
  /** Reference to the UseAIClient (can be null during initialization) */
  clientRef: React.MutableRefObject<UseAIClient | null>;
  /** Whether the client is connected (triggers subscription when true) */
  connected: boolean;
  /**
   * Optional list of agent IDs to show in the UI.
   * When provided, only agents with these IDs will be shown (if they exist on the server).
   * If the list is empty or no agents match, falls back to the default agent.
   */
  visibleAgentIds?: AgentInfo['id'][];
}

export interface UseAgentSelectionReturn {
  /** List of available agents from the server */
  availableAgents: AgentInfo[];
  /** The default agent ID from the server */
  defaultAgent: string | null;
  /** The currently selected agent ID (null means use server default) */
  selectedAgent: string | null;
  /** Sets the agent to use for requests (null to use server default) */
  setAgent: (agentId: string | null) => void;
}

/**
 * Filters server agents based on the provided visibleAgentIds (list of IDs).
 * - If visibleAgentIds is undefined, returns all server agents.
 * - If visibleAgentIds is empty array or no matches found, logs warning and falls back to default agent.
 * - Otherwise, returns matched agents in config order.
 */
function filterAgents(
  serverAgents: AgentInfo[],
  defaultAgentId: string | null,
  visibleAgentIds?: string[]
): AgentInfo[] {
  // Helper to get default agent fallback
  const getDefaultAgentFallback = (): AgentInfo[] => {
    const defaultAgentInfo = serverAgents.find(a => a.id === defaultAgentId);
    return defaultAgentInfo ? [defaultAgentInfo] : serverAgents;
  };

  // visibleAgentIds is undefined - return all server agents
  if (visibleAgentIds === undefined) {
    return serverAgents;
  }

  // Empty array - warn and fallback to default agent
  if (visibleAgentIds.length === 0) {
    console.warn('[AgentSelection] visibleAgentIds is empty array, falling back to default agent');
    return getDefaultAgentFallback();
  }

  // Create a map of server agents for quick lookup
  const serverAgentMap = new Map(serverAgents.map(a => [a.id, a]));

  // Filter based on config IDs, preserving config order
  const matchedAgents = visibleAgentIds
    .filter(id => serverAgentMap.has(id))
    .map(id => serverAgentMap.get(id)!);

  // No matches found - warn and fallback to default agent
  if (matchedAgents.length === 0) {
    console.warn('[AgentSelection] No agents in visibleAgentIds match server agents, falling back to default agent');
    return getDefaultAgentFallback();
  }

  return matchedAgents;
}

/**
 * Hook for managing agent selection state.
 *
 * Features:
 * - Subscribes to agent changes from the server
 * - Tracks available agents, default agent, and user selection
 * - Syncs selection state with the WebSocket client
 * - Filters agents based on visibleAgentIds (list of IDs)
 *
 * @example
 * ```typescript
 * const {
 *   availableAgents,
 *   defaultAgent,
 *   selectedAgent,
 *   setAgent,
 * } = useAgentSelection({ clientRef, connected });
 *
 * // Select a specific agent
 * setAgent('claude-3-5-sonnet');
 *
 * // Reset to server default
 * setAgent(null);
 * ```
 *
 * @example
 * ```typescript
 * // With visibleAgentIds to filter agents by ID
 * const {
 *   availableAgents, // Only includes agents with these IDs
 * } = useAgentSelection({
 *   clientRef,
 *   connected,
 *   visibleAgentIds: ['claude-sonnet', 'claude-opus']
 * });
 * ```
 */
export function useAgentSelection({
  clientRef,
  connected,
  visibleAgentIds,
}: UseAgentSelectionOptions): UseAgentSelectionReturn {
  const [serverAgents, setServerAgents] = useState<AgentInfo[]>([]);
  const [defaultAgent, setDefaultAgent] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  // Filter agents based on config
  const availableAgents = useMemo(
    () => filterAgents(serverAgents, defaultAgent, visibleAgentIds),
    [serverAgents, defaultAgent, visibleAgentIds]
  );

  /**
   * Sets the agent to use for requests.
   * Pass null to reset to server default.
   */
  const setAgent = useCallback((agentId: string | null) => {
    setSelectedAgent(agentId);
    if (clientRef.current) {
      clientRef.current.setAgent(agentId);
    }
    console.log('[AgentSelection] Agent set to:', agentId ?? 'server default');
  }, [clientRef]);

  // Subscribe to agent changes from the server
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !connected) return;

    const unsubscribe = client.onAgentsChange((agents, defaultAgentId) => {
      console.log('[AgentSelection] Received agents:', agents, 'default:', defaultAgentId);
      setServerAgents(agents);
      setDefaultAgent(defaultAgentId);
    });

    return unsubscribe;
  }, [clientRef, connected]);

  // Auto-select the appropriate agent when visibleAgentIds is provided
  // Priority: 1) defaultAgent if it's in availableAgents, 2) first available agent
  useEffect(() => {
    if (selectedAgent === null && availableAgents.length > 0 && !availableAgents.some(a => a.id === defaultAgent)) {
      // Default agent is not available, select the first configured agent
      const firstAgentId = availableAgents[0].id;
      setAgent(firstAgentId);
    }
  }, [availableAgents, selectedAgent, defaultAgent, setAgent]);

  return {
    availableAgents,
    defaultAgent,
    selectedAgent,
    setAgent,
  };
}
