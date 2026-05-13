import { describe, expect, test, beforeEach, afterEach, spyOn } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import type { ModelMessage } from 'ai';
import { applyCacheBreakpoints, isAnthropicModel } from './anthropicCache';
import { logger } from '../logger';

/**
 * Build a minimal Anthropic-flavoured LanguageModel that `isAnthropicModel` recognises.
 */
function createAnthropicMockModel() {
  return new MockLanguageModelV3({
    provider: 'anthropic.messages',
    modelId: 'claude-3-5-sonnet-20241022',
  });
}

describe('applyCacheBreakpoints', () => {
  test('sanity: isAnthropicModel detects the test fixture', () => {
    expect(isAnthropicModel(createAnthropicMockModel())).toBe(true);
  });

  describe('4-breakpoint Anthropic limit warning', () => {
    let warnSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      warnSpy = spyOn(logger, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    test('emits warn when more than 4 cache breakpoints are attached', () => {
      const messages: ModelMessage[] = Array.from({ length: 5 }, (_, i) => ({
        role: 'user',
        content: `message ${i}`,
      }));

      const result = applyCacheBreakpoints(
        messages,
        () => true,
        createAnthropicMockModel()
      );

      const attachedCount = result.filter(
        (m) =>
          (m as { providerOptions?: { anthropic?: { cacheControl?: unknown } } })
            .providerOptions?.anthropic?.cacheControl
      ).length;
      expect(attachedCount).toBe(5);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [warnMessage, warnData] = warnSpy.mock.calls[0] as [
        string,
        Record<string, unknown>?,
      ];
      expect(warnMessage).toBe(
        'Cache breakpoint count exceeds Anthropic limit (4)'
      );
      expect(warnData).toMatchObject({ totalCacheBreakpoints: 5 });
    });

    test('does not warn when 4 or fewer cache breakpoints are attached', () => {
      const messages: ModelMessage[] = Array.from({ length: 4 }, (_, i) => ({
        role: 'user',
        content: `message ${i}`,
      }));

      const result = applyCacheBreakpoints(
        messages,
        () => true,
        createAnthropicMockModel()
      );

      const attachedCount = result.filter(
        (m) =>
          (m as { providerOptions?: { anthropic?: { cacheControl?: unknown } } })
            .providerOptions?.anthropic?.cacheControl
      ).length;
      expect(attachedCount).toBe(4);

      // At the limit -> no warn.
      expect(warnSpy).not.toHaveBeenCalled();
    });

    test('emits warn for entry-attached cache controls even without cacheBreakpoint', () => {
      // The 4-breakpoint diagnostic fires for cache_control attached via entry-level providerOptions, even when no cacheBreakpoint function is configured.
      const messages: ModelMessage[] = Array.from({ length: 5 }, (_, i) => ({
        role: 'system',
        content: `entry ${i}`,
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral', ttl: '5m' } },
        },
      })) as ModelMessage[];

      const result = applyCacheBreakpoints(
        messages,
        undefined,
        createAnthropicMockModel()
      );

      const attachedCount = result.filter(
        (m) =>
          (m as { providerOptions?: { anthropic?: { cacheControl?: unknown } } })
            .providerOptions?.anthropic?.cacheControl
      ).length;
      expect(attachedCount).toBe(5);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [warnMessage, warnData] = warnSpy.mock.calls[0] as [
        string,
        Record<string, unknown>?,
      ];
      expect(warnMessage).toBe(
        'Cache breakpoint count exceeds Anthropic limit (4)'
      );
      expect(warnData).toMatchObject({ totalCacheBreakpoints: 5 });
    });

    test('warn counts both entry-attached and cacheBreakpoint-attached cache controls', () => {
      // 3 entry-level attachments + 2 attached by cacheBreakpoint = 5, exceeds the limit.
      const entryMessages: ModelMessage[] = Array.from({ length: 3 }, (_, i) => ({
        role: 'system',
        content: `entry ${i}`,
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral', ttl: '5m' } },
        },
      })) as ModelMessage[];
      const userMessages: ModelMessage[] = Array.from({ length: 2 }, (_, i) => ({
        role: 'user',
        content: `user ${i}`,
      }));
      const messages: ModelMessage[] = [...entryMessages, ...userMessages];

      const result = applyCacheBreakpoints(
        messages,
        (msg) => msg.role !== 'system',
        createAnthropicMockModel()
      );

      const attachedCount = result.filter(
        (m) =>
          (m as { providerOptions?: { anthropic?: { cacheControl?: unknown } } })
            .providerOptions?.anthropic?.cacheControl
      ).length;
      expect(attachedCount).toBe(5);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [, warnData] = warnSpy.mock.calls[0] as [
        string,
        Record<string, unknown>?,
      ];
      expect(warnData).toMatchObject({ totalCacheBreakpoints: 5 });
    });

    test('non-Anthropic model: never warns even with 5 entry-attached cache controls', () => {
      // The diagnostic is Anthropic-specific.
      const messages: ModelMessage[] = Array.from({ length: 5 }, (_, i) => ({
        role: 'system',
        content: `entry ${i}`,
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral', ttl: '5m' } },
        },
      })) as ModelMessage[];

      const openaiModel = new MockLanguageModelV3({}) as unknown as {
        provider: string;
      };
      openaiModel.provider = 'openai';

      const result = applyCacheBreakpoints(
        messages,
        undefined,
        openaiModel as unknown as MockLanguageModelV3
      );

      expect(result).toBe(messages);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
