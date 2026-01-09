import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { UseAIClient } from '../client';

export interface UsePromptStateOptions {
  /** System prompt to include in state */
  systemPrompt?: string;
  /** Reference to the UseAIClient for state updates */
  clientRef: React.MutableRefObject<UseAIClient | null>;
  /** Whether the client is connected to the server */
  connected: boolean;
}

export interface UsePromptStateReturn {
  /** Updates the prompt and suggestions for a specific component */
  updatePrompt: (id: string, prompt?: string, suggestions?: string[]) => void;
  /** Registers a waiter function for a component */
  registerWaiter: (id: string, waiter: () => Promise<void>) => void;
  /** Unregisters a waiter function */
  unregisterWaiter: (id: string) => void;
  /** Gets the waiter function for a component */
  getWaiter: (id: string) => (() => Promise<void>) | undefined;
  /** All suggestions aggregated from registered components */
  aggregatedSuggestions: string[];
  /** Ref mapping component IDs to prompts */
  promptsRef: React.MutableRefObject<Map<string, string>>;
}

/**
 * Hook for managing prompt state across multiple useAI hooks.
 *
 * Handles:
 * - Storing prompts and suggestions per component
 * - Updating client state when prompts change
 * - Managing waiter functions for prompt change notifications
 * - Aggregating suggestions from all components
 */
export function usePromptState({
  systemPrompt,
  clientRef,
  connected,
}: UsePromptStateOptions): UsePromptStateReturn {
  const promptsRef = useRef<Map<string, string>>(new Map());
  const suggestionsRef = useRef<Map<string, string[]>>(new Map());
  const waitersRef = useRef<Map<string, () => Promise<void>>>(new Map());
  const [suggestionsVersion, setSuggestionsVersion] = useState(0);

  // Build state from all prompts
  const buildStateFromPrompts = useCallback(() => {
    const promptParts: string[] = [];
    if (systemPrompt) {
      promptParts.push(systemPrompt);
    }
    for (const [, prompt] of promptsRef.current.entries()) {
      if (prompt) {
        promptParts.push(prompt);
      }
    }
    return promptParts.length > 0 ? { context: promptParts.join('\n\n---\n\n') } : null;
  }, [systemPrompt]);

  // Sync system prompt to client when connected
  // This ensures the system prompt is sent even when no useAI hooks are present
  useEffect(() => {
    if (connected && clientRef.current && systemPrompt) {
      clientRef.current.updateState(buildStateFromPrompts());
    }
  }, [connected, clientRef, systemPrompt, buildStateFromPrompts]);

  const updatePrompt = useCallback((id: string, prompt?: string, suggestions?: string[]) => {
    if (prompt) {
      promptsRef.current.set(id, prompt);
    } else {
      promptsRef.current.delete(id);
    }

    const hadSuggestions = suggestionsRef.current.has(id);
    if (suggestions && suggestions.length > 0) {
      suggestionsRef.current.set(id, suggestions);
      if (!hadSuggestions) setSuggestionsVersion(v => v + 1);
    } else {
      suggestionsRef.current.delete(id);
      if (hadSuggestions) setSuggestionsVersion(v => v + 1);
    }

    // Update client state immediately when prompts change
    // `connected` in deps ensures this callback reference changes when connection is established,
    // triggering useAI's effect to re-run and sync prompts to the client
    if (clientRef.current) {
      clientRef.current.updateState(buildStateFromPrompts());
    }
  }, [buildStateFromPrompts, clientRef, connected]);

  const registerWaiter = useCallback((id: string, waiter: () => Promise<void>) => {
    waitersRef.current.set(id, waiter);
  }, []);

  const unregisterWaiter = useCallback((id: string) => {
    waitersRef.current.delete(id);
  }, []);

  const getWaiter = useCallback((id: string) => {
    return waitersRef.current.get(id);
  }, []);

  const aggregatedSuggestions = useMemo(() => {
    const allSuggestions: string[] = [];
    suggestionsRef.current.forEach((suggestions) => {
      allSuggestions.push(...suggestions);
    });
    return allSuggestions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionsVersion]);

  return {
    updatePrompt,
    registerWaiter,
    unregisterWaiter,
    getWaiter,
    aggregatedSuggestions,
    promptsRef,
  };
}
