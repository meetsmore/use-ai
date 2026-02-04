/**
 * Unit tests for FeedbackPlugin with Langfuse singleton enabled.
 */

import { describe, expect, test, beforeEach, mock } from 'bun:test';
import type { ClientSession } from '../agents/types';
import type { Langfuse } from 'langfuse';

// Mock Langfuse client factory
const mockScore = mock(() => {});
const mockFlushAsync = mock(() => Promise.resolve());

function createMockLangfuseClient(): Langfuse {
  return {
    score: mockScore,
    flushAsync: mockFlushAsync,
  } as unknown as Langfuse;
}

// Mock the instrumentation module with an enabled singleton
const mockSingletonClient = createMockLangfuseClient();
mock.module('../instrumentation', () => ({
  langfuse: {
    enabled: true,
    client: mockSingletonClient,
  },
  pushTraceIdForRun: () => {},
  popTraceIdForRun: () => undefined,
}));

// Import after mocking
import { FeedbackPlugin } from './FeedbackPlugin';

describe('FeedbackPlugin (singleton enabled)', () => {
  beforeEach(() => {
    mockScore.mockClear();
    mockFlushAsync.mockClear();
  });

  describe('initialization', () => {
    test('uses singleton client by default', () => {
      const plugin = new FeedbackPlugin();
      expect(plugin.isEnabled()).toBe(true);
    });

    test('explicit client overrides singleton', () => {
      const explicitClient = createMockLangfuseClient();
      const plugin = new FeedbackPlugin(explicitClient);
      expect(plugin.isEnabled()).toBe(true);
    });
  });

  describe('registerHandlers', () => {
    test('registers message_feedback handler', () => {
      const plugin = new FeedbackPlugin();
      const registerMessageHandler = mock(() => {});

      plugin.registerHandlers({ registerMessageHandler });

      expect(registerMessageHandler).toHaveBeenCalledWith(
        'message_feedback',
        expect.any(Function)
      );
    });
  });

  describe('onClientConnect', () => {
    test('emits langfuseEnabled=true when using singleton', () => {
      const plugin = new FeedbackPlugin();
      const mockEmit = mock(() => {});
      const session = {
        socket: { emit: mockEmit },
      } as unknown as ClientSession;

      plugin.onClientConnect(session);

      expect(mockEmit).toHaveBeenCalledWith('config', {
        langfuseEnabled: true,
      });
    });
  });

  describe('handleFeedback', () => {
    test('submits score to Langfuse for thumbs up', async () => {
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
          messageId: 'msg-123',
          traceId: 'trace-abc',
          feedback: 'upvote',
        },
      };

      await feedbackHandler!(session, message);

      expect(mockScore).toHaveBeenCalledWith({
        traceId: 'trace-abc',
        name: 'user-feedback',
        value: 1,
        id: 'msg-123-user-feedback',
      });
    });

    test('submits score to Langfuse for thumbs down', async () => {
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
          messageId: 'msg-456',
          traceId: 'trace-def',
          feedback: 'downvote',
        },
      };

      await feedbackHandler!(session, message);

      expect(mockScore).toHaveBeenCalledWith({
        traceId: 'trace-def',
        name: 'user-feedback',
        value: 0,
        id: 'msg-456-user-feedback',
      });
    });

    test('does not submit score when feedback is null (removed)', async () => {
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
          messageId: 'msg-789',
          traceId: 'trace-ghi',
          feedback: null,
        },
      };

      await feedbackHandler!(session, message);

      expect(mockScore).not.toHaveBeenCalled();
    });

    test('uses idempotent score ID based on messageId', async () => {
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

      // First feedback
      await feedbackHandler!(session, {
        type: 'message_feedback',
        data: { messageId: 'msg-same', traceId: 'trace-x', feedback: 'upvote' },
      });

      // Update feedback (same messageId)
      await feedbackHandler!(session, {
        type: 'message_feedback',
        data: { messageId: 'msg-same', traceId: 'trace-x', feedback: 'downvote' },
      });

      // Both should use the same score ID for idempotency
      expect(mockScore).toHaveBeenCalledTimes(2);
      const calls = mockScore.mock.calls as unknown as Array<[{ id: string }]>;
      expect(calls[0][0].id).toBe('msg-same-user-feedback');
      expect(calls[1][0].id).toBe('msg-same-user-feedback');
    });
  });

  describe('close', () => {
    test('flushes Langfuse events', async () => {
      const plugin = new FeedbackPlugin();
      await plugin.close();

      expect(mockFlushAsync).toHaveBeenCalled();
    });
  });
});
