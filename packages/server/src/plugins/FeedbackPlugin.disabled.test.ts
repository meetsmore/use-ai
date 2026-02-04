/**
 * Unit tests for FeedbackPlugin when Langfuse singleton is disabled.
 * This is a separate file so we can mock the langfuse singleton, as the singleton is at file scope.
 */

import { describe, expect, test, beforeEach, mock } from 'bun:test';
import type { ClientSession } from '../agents/types';
import type { Langfuse } from 'langfuse';

// Mock Langfuse client factory for explicit client tests
const mockScore = mock(() => {});
const mockFlushAsync = mock(() => Promise.resolve());

function createMockLangfuseClient(): Langfuse {
  return {
    score: mockScore,
    flushAsync: mockFlushAsync,
  } as unknown as Langfuse;
}

// Mock the instrumentation module with a disabled singleton (no client)
mock.module('../instrumentation', () => ({
  langfuse: {
    enabled: false,
    client: undefined,
  },
  pushTraceIdForRun: () => {},
  popTraceIdForRun: () => undefined,
}));

// Import after mocking
import { FeedbackPlugin } from './FeedbackPlugin';

describe('FeedbackPlugin (singleton disabled)', () => {
  beforeEach(() => {
    mockScore.mockClear();
    mockFlushAsync.mockClear();
  });

  describe('initialization', () => {
    test('is disabled when singleton has no client', () => {
      const plugin = new FeedbackPlugin();
      expect(plugin.isEnabled()).toBe(false);
    });

    test('explicit client enables plugin even when singleton is disabled', () => {
      const explicitClient = createMockLangfuseClient();
      const plugin = new FeedbackPlugin(explicitClient);
      expect(plugin.isEnabled()).toBe(true);
    });
  });

  describe('onClientConnect', () => {
    test('emits langfuseEnabled=false when disabled', () => {
      const plugin = new FeedbackPlugin();
      const mockEmit = mock(() => {});
      const session = {
        socket: { emit: mockEmit },
      } as unknown as ClientSession;

      plugin.onClientConnect(session);

      expect(mockEmit).toHaveBeenCalledWith('config', {
        langfuseEnabled: false,
      });
    });
  });

  describe('handleFeedback', () => {
    test('does not submit score when plugin is disabled', async () => {
      const plugin = new FeedbackPlugin();
      let feedbackHandler: Function;

      plugin.registerHandlers({
        registerMessageHandler: (type: string, handler: Function) => {
          if (type === 'message_feedback') {
            feedbackHandler = handler;
          }
        },
      });

      const session = {} as ClientSession;
      const message = {
        type: 'message_feedback',
        data: {
          messageId: 'msg-000',
          traceId: 'trace-000',
          feedback: 'upvote',
        },
      };

      await feedbackHandler!(session, message);

      expect(mockScore).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    test('does nothing when disabled', async () => {
      const plugin = new FeedbackPlugin();
      await plugin.close();

      expect(mockFlushAsync).not.toHaveBeenCalled();
    });
  });
});
