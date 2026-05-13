import { useState, useCallback, useRef, useMemo } from 'react';
import type { UseAIClient } from '../client';

export interface UsePromptStateOptions {
  /** Reference to the UseAIClient for state updates */
  clientRef: React.MutableRefObject<UseAIClient | null>;
  /** Whether the client is connected to the server */
  connected: boolean;
}

export interface UsePromptStateReturn {
  /** Updates the prompt and suggestions for a specific component */
  updatePrompt: (id: string, prompt?: string, suggestions?: string[]) => void;
  /** All suggestions aggregated from registered components */
  aggregatedSuggestions: string[];
  /** Builds the aggregated state from all registered prompts */
  buildStateFromPrompts: () => { context: string } | null;
}

/**
 * Hook for managing per-step state context from `useAI({ prompt })` hooks.
 *
 * Scope: aggregates per-component `prompt` strings into `state.context`. System prompts are out of scope — they travel on `forwardedProps.systemPrompts`.
 *
 * Handles:
 * - Storing prompts and suggestions per component
 * - Updating client state when prompts change
 * - Aggregating suggestions from all components
 */
export function usePromptState({
  clientRef,
  connected,
}: UsePromptStateOptions): UsePromptStateReturn {
  const promptsRef = useRef<Map<string, string>>(new Map());
  const suggestionsRef = useRef<Map<string, string[]>>(new Map());
  const [suggestionsVersion, setSuggestionsVersion] = useState(0);

  const buildStateFromPrompts = useCallback(() => {
    const promptParts: string[] = [];
    for (const [, prompt] of promptsRef.current.entries()) {
      if (prompt) {
        promptParts.push(prompt);
      }
    }
    return promptParts.length > 0 ? { context: promptParts.join('\n\n---\n\n') } : null;
  }, []);

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

    // `connected` is in deps so this callback's reference changes when connection is established, which re-runs downstream effects that sync prompts to the client.
    if (clientRef.current) {
      clientRef.current.updateState(buildStateFromPrompts());
    }
  }, [buildStateFromPrompts, clientRef, connected]);

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
    aggregatedSuggestions,
    buildStateFromPrompts,
  };
}
