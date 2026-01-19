/**
 * Anthropic prompt caching utilities for AI SDK Agent.
 *
 * This module handles cache breakpoint configuration for Anthropic models (Claude).
 * Prompt caching reduces costs and latency by caching message prefixes.
 *
 * @see https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 */

import type { LanguageModel, ModelMessage } from 'ai';
import { logger } from '../logger';

/**
 * ModelMessage extended with positional context for cache breakpoint decisions.
 * Used by the cacheBreakpoint config to determine which messages should have
 * Anthropic's cache_control breakpoints applied.
 *
 * System prompt is included as role: 'system' at index 0 when present.
 */
export type MessageWithCacheContext = ModelMessage & {
  /** Position in the messages array (0-indexed, system prompt is 0 if present) */
  index: number;
  /** Total number of messages including system prompt */
  totalCount: number;
  /** True if this is the first message */
  isFirst: boolean;
  /** True if this is the last message */
  isLast: boolean;
};

/**
 * Cache TTL options for Anthropic prompt caching.
 * - '5m': 5-minute cache (default, refreshed on each use at no cost)
 * - '1h': 1-hour cache (additional cost, useful for infrequent access patterns)
 *
 * @see https://platform.claude.com/docs/en/build-with-claude/prompt-caching#1-hour-cache-duration
 */
export type CacheTtl = '5m' | '1h';

/**
 * Return type for cacheBreakpoint function.
 * - `false` / `null` / `undefined`: No cache breakpoint
 * - `true`: Cache breakpoint with default TTL (5m)
 * - `'5m'` / `'1h'`: Cache breakpoint with specified TTL
 */
export type CacheBreakpointResult = boolean | CacheTtl | null | undefined;

/**
 * Function type for determining cache breakpoints.
 */
export type CacheBreakpointFn = (message: MessageWithCacheContext) => CacheBreakpointResult;

/**
 * Checks if the given model is an Anthropic model (Claude).
 */
export function isAnthropicModel(model: LanguageModel): boolean {
  // String format: "anthropic/claude-3-5-sonnet-20241022"
  if (typeof model === 'string') {
    return model.startsWith('anthropic/');
  }
  // Object format: { provider: 'anthropic' | 'anthropic.messages' | ... }
  const provider = (model as { provider?: string }).provider;
  return provider?.startsWith('anthropic') ?? false;
}

/**
 * Applies cache breakpoints to messages for Anthropic prompt caching.
 * Only applies when:
 * 1. cacheBreakpoint config is provided
 * 2. Model is an Anthropic model
 *
 * Adds providerOptions.anthropic.cacheControl to messages where
 * the cacheBreakpoint function returns true.
 *
 * @param messages - The messages array (system prompt should be prepended as role: 'system')
 * @param cacheBreakpoint - Function to determine which messages should have cache breakpoints
 * @param model - The AI SDK LanguageModel to check if it's Anthropic
 * @returns Messages with cache control providerOptions added where applicable
 */
export function applyCacheBreakpoints(
  messages: ModelMessage[],
  cacheBreakpoint: CacheBreakpointFn | undefined,
  model: LanguageModel
): ModelMessage[] {
  // Skip if no cacheBreakpoint configured or not Anthropic model
  if (!cacheBreakpoint || !isAnthropicModel(model)) {
    return messages;
  }

  const totalCount = messages.length;
  let cacheBreakpointCount = 0;

  const result = messages.map((message, index) => {
    const context: MessageWithCacheContext = {
      ...message,
      index,
      totalCount,
      isFirst: index === 0,
      isLast: index === totalCount - 1,
    };

    const breakpointResult = cacheBreakpoint(context);

    // Check if we should add a cache breakpoint
    // truthy values: true, '5m', '1h'
    // falsy values: false, null, undefined
    if (breakpointResult) {
      cacheBreakpointCount++;

      // Build cache control object
      // If result is a TTL string ('5m' or '1h'), include it
      // If result is `true`, use default (no TTL field = 5m default)
      const cacheControl: { type: 'ephemeral'; ttl?: CacheTtl } =
        typeof breakpointResult === 'string'
          ? { type: 'ephemeral', ttl: breakpointResult }
          : { type: 'ephemeral' };

      // Add cache control to the message
      return {
        ...message,
        providerOptions: {
          ...(message as { providerOptions?: Record<string, unknown> }).providerOptions,
          anthropic: {
            cacheControl,
          },
        },
      };
    }

    return message;
  });

  if (cacheBreakpointCount > 0) {
    logger.debug('Applied cache breakpoints', {
      totalMessages: totalCount,
      cacheBreakpointCount,
    });
  }

  return result;
}
