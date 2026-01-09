import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAIContext } from './providers/useAIProvider';
import { type ToolsDefinition } from './defineTool';
import { useStableTools } from './hooks/useStableTools';
import type { AGUIEvent, RunErrorEvent } from './types';
import { EventType } from './types';

function namespaceTools(tools: ToolsDefinition, namespace: string): ToolsDefinition {
  const namespacedTools: ToolsDefinition = {};

  for (const [toolName, tool] of Object.entries(tools)) {
    const namespacedName = `${namespace}_${toolName}`;
    namespacedTools[namespacedName] = tool;
  }

  return namespacedTools;
}

/**
 * Options for configuring the useAI hook.
 */
export interface UseAIOptions {
  /** Tools to make available to the AI for this component */
  tools?: ToolsDefinition;
  /** Callback function invoked when an error occurs */
  onError?: (error: Error) => void;
  /** Optional ID for namespacing tools to avoid naming conflicts */
  id?: string;
  /** Optional UI context or description to send to the AI */
  prompt?: string;
  /**
   * Mark this component as invisible (no visual state).
   * When true, tool responses are sent immediately without waiting for prompt changes.
   * Use this for provider-type components that expose tools but don't render UI.
   * @default false
   */
  invisible?: boolean;
  /**
   * Optional array of suggestion strings to display as call-to-action prompts
   * when the chat is empty. The chat UI will randomly select up to 4 suggestions
   * to display to the user.
   */
  suggestions?: string[];
  /**
   * Whether the AI features are enabled for this hook.
   * When false, tools are not registered and the hook returns a disabled state.
   * Useful for feature flagging AI functionality.
   * @default true
   */
  enabled?: boolean;
}

/**
 * Return value from the useAI hook.
 */
export interface UseAIResult {
  /** The AI's response text, or null if no response yet */
  response: string | null;
  /** Whether the AI is currently processing a request */
  loading: boolean;
  /** Error object if an error occurred, or null */
  error: Error | null;
  /** Function to send a prompt to the AI */
  generate: (prompt: string) => Promise<void>;
  /** Whether the client is connected to the server */
  connected: boolean;
  /** Ref to attach to the component for context extraction */
  ref: React.RefObject<HTMLDivElement>;
}

/**
 * React hook for integrating AI capabilities into a component.
 * Registers tools with the AI server and provides methods to interact with the AI.
 */
export function useAI(options: UseAIOptions = {}): UseAIResult {
  const { enabled = true } = options;
  const { connected, tools, client, prompts } = useAIContext();
  const { register: registerTools, unregister: unregisterTools } = tools;
  const { update: updatePrompt, registerWaiter, unregisterWaiter } = prompts;
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const hookId = useRef(`useAI-${Math.random().toString(36).substr(2, 9)}`);
  const toolsRef = useRef<ToolsDefinition>({});
  const componentRef = useRef<HTMLDivElement>(null);

  // Prompt change tracking
  const promptChangeResolvers = useRef<Array<() => void>>([]);

  // Stabilize tools to prevent render loops from unstable references.
  // This allows users to define tools inline without memoization.
  const stableTools = useStableTools(options.tools);

  // Derive a key for effect dependencies (based on tool names only)
  const toolsKey = useMemo(() => {
    if (!options.tools) return '';
    return Object.keys(options.tools).sort().join(',');
  }, [options.tools]);

  const memoizedSuggestions = useMemo(() => options.suggestions, [options.suggestions]);

  useEffect(() => {
    if (componentRef.current) {
      componentRef.current.setAttribute('data-useai-context', 'true');
    }
  }, []);

  // Create waitForPromptChange function that resolves when prompt changes (with timeout)
  const waitForPromptChange = useCallback((): Promise<void> => {
    return new Promise<void>(resolve => {
      const timeoutMs = 100;

      const timeoutId = setTimeout(() => {
        const index = promptChangeResolvers.current.indexOf(resolveAndCleanup);
        if (index !== -1) {
          promptChangeResolvers.current.splice(index, 1);
        }
        resolve();
      }, timeoutMs);

      const resolveAndCleanup = () => {
        clearTimeout(timeoutId);
        resolve();
      };

      promptChangeResolvers.current.push(resolveAndCleanup);
    });
  }, []);

  // Register/unregister the waiter with the provider
  useEffect(() => {
    if (!enabled || options.invisible) return;

    registerWaiter(hookId.current, waitForPromptChange);
    return () => {
      unregisterWaiter(hookId.current);
    };
  }, [enabled, options.invisible, registerWaiter, unregisterWaiter, waitForPromptChange]);

  // Update prompt and resolve any pending waiters when prompt changes
  useEffect(() => {
    if (!enabled) return;
    updatePrompt(hookId.current, options.prompt, memoizedSuggestions);

    // Resolve any pending prompt change waiters
    if (promptChangeResolvers.current.length > 0) {
      promptChangeResolvers.current.forEach(resolve => resolve());
      promptChangeResolvers.current = [];
    }
  }, [enabled, options.prompt, memoizedSuggestions, updatePrompt]);

  // Store updatePrompt in a ref to avoid stale closure in unmount cleanup
  const updatePromptRef = useRef(updatePrompt);
  updatePromptRef.current = updatePrompt;

  // Cleanup prompt and suggestions on unmount only (separate effect with empty deps)
  useEffect(() => {
    const id = hookId.current;
    return () => {
      updatePromptRef.current(id, undefined, undefined);
    };
  }, []);

  // Register tools
  useEffect(() => {
    if (!enabled) return;
    if (stableTools) {
      const componentId = options.id || componentRef.current?.id;
      const toolsToRegister = componentId
        ? namespaceTools(stableTools, componentId)
        : stableTools;

      registerTools(hookId.current, toolsToRegister, { invisible: options.invisible });
      toolsRef.current = toolsToRegister;
    }

    return () => {
      if (stableTools) {
        unregisterTools(hookId.current);
      }
    };
  }, [enabled, toolsKey, stableTools, options.id, options.invisible, registerTools, unregisterTools]);

  useEffect(() => {
    if (!enabled || !client) return;

    const unsubscribe = client.onEvent(hookId.current, (event: AGUIEvent) => {
      handleAGUIEvent(event);
    });

    return () => {
      unsubscribe();
    };
  }, [enabled, client]);

  const handleAGUIEvent = useCallback(async (event: AGUIEvent) => {
    switch (event.type) {
      case EventType.TEXT_MESSAGE_END: {
        const content = client?.currentMessageContent;
        if (content) {
          setResponse(content);
          setLoading(false);
        }
        break;
      }

      case EventType.RUN_ERROR: {
        const errorEvent = event as RunErrorEvent;
        const error = new Error(errorEvent.message);
        setError(error);
        setLoading(false);
        options.onError?.(error);
        break;
      }
    }
  }, [client, options.onError]);

  const generate = useCallback(async (prompt: string) => {
    if (!enabled) {
      const error = new Error('AI features are disabled');
      setError(error);
      options.onError?.(error);
      return;
    }

    if (!client?.isConnected()) {
      const error = new Error('Not connected to server');
      setError(error);
      options.onError?.(error);
      return;
    }

    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      client.sendPrompt(prompt);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
      setLoading(false);
      options.onError?.(error);
    }
  }, [enabled, client, options.onError]);

  return {
    response,
    loading,
    error,
    generate,
    connected: enabled && connected,
    ref: componentRef,
  };
}
