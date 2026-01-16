import type {
  AgentPlugin,
  AgentPluginContext,
  AgentRunInput,
  AgentRunResult,
  ToolCallInfo,
  ToolResultInfo,
} from './types';

/**
 * Orchestrates plugin execution for AISDKAgent.
 *
 * Plugins are executed in the order they were registered.
 * Each hook is called sequentially, with the output of one plugin
 * becoming the input of the next.
 *
 * @example
 * ```typescript
 * const runner = new AgentPluginRunner([
 *   loggingPlugin,
 *   metricsPlugin,
 * ]);
 *
 * // Initialize plugins
 * await runner.initialize({ provider: 'anthropic' });
 *
 * // Use in agent run
 * const processedInput = await runner.onUserMessage(input, context);
 * ```
 */
export class AgentPluginRunner {
  private plugins: AgentPlugin[] = [];

  constructor(plugins: AgentPlugin[] = []) {
    this.plugins = plugins;
  }

  /**
   * Initialize all plugins.
   * Called once when the agent is created.
   */
  async initialize(context: { provider: string }): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.initialize?.(context);
    }
  }

  /**
   * Run onUserMessage hook for all plugins.
   * Each plugin receives the output of the previous plugin.
   */
  async onUserMessage(
    input: AgentRunInput,
    context: AgentPluginContext
  ): Promise<AgentRunInput> {
    let result = input;
    for (const plugin of this.plugins) {
      if (plugin.onUserMessage) {
        result = await plugin.onUserMessage(result, context);
      }
    }
    return result;
  }

  /**
   * Run onAgentResponse hook for all plugins.
   * Each plugin receives the output of the previous plugin.
   */
  async onAgentResponse(
    result: AgentRunResult,
    context: AgentPluginContext
  ): Promise<AgentRunResult> {
    let processed = result;
    for (const plugin of this.plugins) {
      if (plugin.onAgentResponse) {
        processed = await plugin.onAgentResponse(processed, context);
      }
    }
    return processed;
  }

  /**
   * Run onTextChunk hook for all plugins.
   * Returns the transformed chunk (or original if no transform).
   */
  async onTextChunk(
    chunk: string,
    context: AgentPluginContext
  ): Promise<string> {
    let result = chunk;
    for (const plugin of this.plugins) {
      if (plugin.onTextChunk) {
        const transformed = await plugin.onTextChunk(result, context);
        if (typeof transformed === 'string') {
          result = transformed;
        }
      }
    }
    return result;
  }

  /**
   * Run onBeforeToolCall hook for all plugins.
   * Returns null if any plugin returns null (tool call should be skipped).
   */
  async onBeforeToolCall(
    toolCall: ToolCallInfo,
    context: AgentPluginContext
  ): Promise<ToolCallInfo | null> {
    let current: ToolCallInfo | null = toolCall;
    for (const plugin of this.plugins) {
      if (current === null) break;
      if (plugin.onBeforeToolCall) {
        current = await plugin.onBeforeToolCall(current, context);
      }
    }
    return current;
  }

  /**
   * Run onAfterToolCall hook for all plugins.
   * Returns the final transformed result.
   */
  async onAfterToolCall(
    toolResult: ToolResultInfo,
    context: AgentPluginContext
  ): Promise<unknown> {
    let result = toolResult.result;
    for (const plugin of this.plugins) {
      if (plugin.onAfterToolCall) {
        result = await plugin.onAfterToolCall({ ...toolResult, result }, context);
      }
    }
    return result;
  }

  /**
   * Destroy all plugins and release resources.
   */
  async destroy(): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.destroy?.();
    }
  }

  /**
   * Check if any plugins are registered.
   */
  hasPlugins(): boolean {
    return this.plugins.length > 0;
  }

  /**
   * Get the number of registered plugins.
   */
  get pluginCount(): number {
    return this.plugins.length;
  }
}
