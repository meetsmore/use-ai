/**
 * Unit tests for FeedbackPlugin.
 *
 * The tests inject the Langfuse singleton through the constructor.
 * They do not use mock.module(), because Bun applies it to the whole process.
 */

import { describe, expect, test, beforeEach, mock } from 'bun:test';
import type { ClientSession } from '../agents/types';
import type { LangfuseApi } from '../instrumentation';
import { createMockLangfuseClient } from '../../test/langfuse-mock';
import { FeedbackPlugin } from './FeedbackPlugin';

const mockScore = mock(() => {});
const mockFlush = mock(() => Promise.resolve());

// The Langfuse singleton when Langfuse is enabled
const enabledLangfuse: LangfuseApi = {
  enabled: true,
  client: createMockLangfuseClient({ score: mockScore, flush: mockFlush }),
};

// The Langfuse singleton when Langfuse is disabled
const disabledLangfuse: LangfuseApi = {
  enabled: false,
  client: undefined,
};

describe('FeedbackPlugin (singleton enabled)', () => {
  beforeEach(() => {
    mockScore.mockClear();
    mockFlush.mockClear();
  });

  describe('initialization', () => {
    test('uses singleton client by default', () => {
      const plugin = new FeedbackPlugin(undefined, enabledLangfuse);
      expect(plugin.isEnabled()).toBe(true);
    });

    test('explicit client overrides singleton', () => {
      const explicitClient = createMockLangfuseClient({ score: mockScore, flush: mockFlush });
      const plugin = new FeedbackPlugin(explicitClient, enabledLangfuse);
      expect(plugin.isEnabled()).toBe(true);
    });
  });

  describe('registerHandlers', () => {
    test('registers message_feedback handler', () => {
      const plugin = new FeedbackPlugin(undefined, enabledLangfuse);
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
      const plugin = new FeedbackPlugin(undefined, enabledLangfuse);
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
      const plugin = new FeedbackPlugin(undefined, enabledLangfuse);
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
      const plugin = new FeedbackPlugin(undefined, enabledLangfuse);
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
      const plugin = new FeedbackPlugin(undefined, enabledLangfuse);
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
      const plugin = new FeedbackPlugin(undefined, enabledLangfuse);
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
      const plugin = new FeedbackPlugin(undefined, enabledLangfuse);
      await plugin.close();

      expect(mockFlush).toHaveBeenCalled();
    });
  });
});

describe('FeedbackPlugin (singleton disabled)', () => {
  beforeEach(() => {
    mockScore.mockClear();
    mockFlush.mockClear();
  });

  describe('initialization', () => {
    test('is disabled when singleton has no client', () => {
      const plugin = new FeedbackPlugin(undefined, disabledLangfuse);
      expect(plugin.isEnabled()).toBe(false);
    });

    test('explicit client enables plugin even when singleton is disabled', () => {
      const explicitClient = createMockLangfuseClient({ score: mockScore, flush: mockFlush });
      const plugin = new FeedbackPlugin(explicitClient, disabledLangfuse);
      expect(plugin.isEnabled()).toBe(true);
    });
  });

  describe('onClientConnect', () => {
    test('emits langfuseEnabled=false when disabled', () => {
      const plugin = new FeedbackPlugin(undefined, disabledLangfuse);
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
      const plugin = new FeedbackPlugin(undefined, disabledLangfuse);
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
      const plugin = new FeedbackPlugin(undefined, disabledLangfuse);
      await plugin.close();

      expect(mockFlush).not.toHaveBeenCalled();
    });
  });
});

describe('FeedbackPlugin with a real LangfuseClient', () => {
  test('sends the user-feedback score to the Langfuse API on close', async () => {
    const { LangfuseClient } = await import('@langfuse/client');
    const requests: Array<{ path: string; body: unknown }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        requests.push({ path: new URL(req.url).pathname, body: await req.json() });
        return Response.json({ successes: [], errors: [] }, { status: 207 });
      },
    });

    try {
      const client = new LangfuseClient({ publicKey: 'pk-test', secretKey: 'sk-test', baseUrl: server.url.origin });
      const plugin = new FeedbackPlugin(client);
      let feedbackHandler: Function;
      plugin.registerHandlers({
        registerMessageHandler: (type: string, handler: Function) => {
          if (type === 'message_feedback') feedbackHandler = handler;
        },
      });

      await feedbackHandler!({} as ClientSession, {
        type: 'message_feedback',
        data: { messageId: 'msg-real', traceId: 'trace-real', feedback: 'downvote' },
      });
      await plugin.close();

      const events = requests.flatMap(r => (r.body as { batch: Array<{ type: string; body: unknown }> }).batch);
      expect(events).toContainEqual(expect.objectContaining({
        type: 'score-create',
        body: expect.objectContaining({
          id: 'msg-real-user-feedback',
          traceId: 'trace-real',
          name: 'user-feedback',
          value: 0,
        }),
      }));
    } finally {
      server.stop(true);
    }
  });
});
