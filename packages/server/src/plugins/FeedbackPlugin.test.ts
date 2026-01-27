/**
 * Unit tests for FeedbackPlugin.
 */

import { describe, expect, test, beforeEach, mock, spyOn } from 'bun:test';
import { FeedbackPlugin } from './FeedbackPlugin';
import type { ClientSession } from '../agents/types';

// Mock Langfuse
const mockScore = mock(() => {});
const mockFlushAsync = mock(() => Promise.resolve());

mock.module('langfuse', () => ({
  Langfuse: class MockLangfuse {
    score = mockScore;
    flushAsync = mockFlushAsync;
  },
}));

describe('FeedbackPlugin', () => {
  beforeEach(() => {
    mockScore.mockClear();
    mockFlushAsync.mockClear();
    // Clear env vars
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_BASE_URL;
  });

  describe('initialization', () => {
    test('is disabled when no credentials provided', () => {
      const plugin = new FeedbackPlugin();
      expect(plugin.isEnabled()).toBe(false);
    });

    test('is disabled when only public key provided', () => {
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
      const plugin = new FeedbackPlugin();
      expect(plugin.isEnabled()).toBe(false);
    });

    test('is disabled when only secret key provided', () => {
      process.env.LANGFUSE_SECRET_KEY = 'sk-test';
      const plugin = new FeedbackPlugin();
      expect(plugin.isEnabled()).toBe(false);
    });

    test('is enabled when both keys provided via env vars', () => {
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
      process.env.LANGFUSE_SECRET_KEY = 'sk-test';
      const plugin = new FeedbackPlugin();
      expect(plugin.isEnabled()).toBe(true);
    });

    test('is enabled when both keys provided via config', () => {
      const plugin = new FeedbackPlugin({
        publicKey: 'pk-config',
        secretKey: 'sk-config',
      });
      expect(plugin.isEnabled()).toBe(true);
    });

    test('config takes precedence over env vars', () => {
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-env';
      process.env.LANGFUSE_SECRET_KEY = 'sk-env';

      const plugin = new FeedbackPlugin({
        publicKey: 'pk-config',
        secretKey: 'sk-config',
      });

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
    test('emits langfuseEnabled config to client when enabled', () => {
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
      process.env.LANGFUSE_SECRET_KEY = 'sk-test';

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
    test('submits score to Langfuse for thumbs up', async () => {
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
      process.env.LANGFUSE_SECRET_KEY = 'sk-test';

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
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
      process.env.LANGFUSE_SECRET_KEY = 'sk-test';

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
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
      process.env.LANGFUSE_SECRET_KEY = 'sk-test';

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

    test('does not submit score when plugin is disabled', async () => {
      // No credentials = disabled
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

    test('uses idempotent score ID based on messageId', async () => {
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
      process.env.LANGFUSE_SECRET_KEY = 'sk-test';

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
    test('flushes Langfuse events when enabled', async () => {
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';
      process.env.LANGFUSE_SECRET_KEY = 'sk-test';

      const plugin = new FeedbackPlugin();
      await plugin.close();

      expect(mockFlushAsync).toHaveBeenCalled();
    });

    test('does nothing when disabled', async () => {
      const plugin = new FeedbackPlugin();
      await plugin.close();

      expect(mockFlushAsync).not.toHaveBeenCalled();
    });
  });
});
