/**
 * Integration tests for the feedback feature.
 *
 * Tests the full feedback flow from client connection to Langfuse score submission.
 * Langfuse is mocked to verify the correct API calls are made.
 */

import { describe, expect, test, beforeEach, afterAll, mock } from 'bun:test';
import { UseAIServer } from './server';
import { FeedbackPlugin } from './plugins/FeedbackPlugin';
import { EventType } from './types';
import {
  createTestAgent,
  TestCleanupManager,
} from '../test/integration-test-utils';
import {
  sendRunAgent,
  collectEventsUntil,
} from '../test/test-utils';

// Mock Langfuse before imports that use it
const mockScore = mock(() => {});
const mockFlushAsync = mock(() => Promise.resolve());

mock.module('langfuse', () => ({
  Langfuse: class MockLangfuse {
    score = mockScore;
    flushAsync = mockFlushAsync;
  },
}));

const cleanup = new TestCleanupManager();

afterAll(() => {
  cleanup.cleanup();
});

describe('Feedback Integration', () => {
  beforeEach(() => {
    mockScore.mockClear();
    mockFlushAsync.mockClear();
  });

  describe('Client Configuration', () => {
    test('client receives langfuseEnabled=true when FeedbackPlugin is enabled', async () => {
      const port = 9100;

      // Set up env vars for Langfuse
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test-integration';
      process.env.LANGFUSE_SECRET_KEY = 'sk-test-integration';

      const feedbackPlugin = new FeedbackPlugin();
      expect(feedbackPlugin.isEnabled()).toBe(true);

      const server = new UseAIServer({
        port,
        agents: { test: createTestAgent() },
        defaultAgent: 'test',
        plugins: [feedbackPlugin],
      });
      cleanup.trackServer(server);

      const socket = await cleanup.createTestClient(port);

      // Wait for config event
      const configPromise = new Promise<{ langfuseEnabled: boolean }>((resolve) => {
        socket.on('config', (config) => {
          resolve(config);
        });
      });

      const config = await configPromise;
      expect(config.langfuseEnabled).toBe(true);

      socket.disconnect();
      server.close();

      // Clean up env vars
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    });

    test('client receives langfuseEnabled=false when FeedbackPlugin is disabled', async () => {
      const port = 9101;

      // Ensure no Langfuse credentials
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;

      const feedbackPlugin = new FeedbackPlugin();
      expect(feedbackPlugin.isEnabled()).toBe(false);

      const server = new UseAIServer({
        port,
        agents: { test: createTestAgent() },
        defaultAgent: 'test',
        plugins: [feedbackPlugin],
      });
      cleanup.trackServer(server);

      const socket = await cleanup.createTestClient(port);

      // Wait for config event
      const configPromise = new Promise<{ langfuseEnabled: boolean }>((resolve) => {
        socket.on('config', (config) => {
          resolve(config);
        });
      });

      const config = await configPromise;
      expect(config.langfuseEnabled).toBe(false);

      socket.disconnect();
      server.close();
    });
  });

  describe('Feedback Submission', () => {
    test('feedback message triggers Langfuse score submission', async () => {
      const port = 9102;

      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test-feedback';
      process.env.LANGFUSE_SECRET_KEY = 'sk-test-feedback';

      const feedbackPlugin = new FeedbackPlugin();
      const server = new UseAIServer({
        port,
        agents: { test: createTestAgent() },
        defaultAgent: 'test',
        plugins: [feedbackPlugin],
      });
      cleanup.trackServer(server);

      const socket = await cleanup.createTestClient(port);

      // Wait for connection to be established
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send feedback message
      socket.emit('message', {
        type: 'message_feedback',
        data: {
          messageId: 'msg-integration-test',
          traceId: 'trace-integration-test',
          feedback: 'upvote',
        },
      });

      // Wait for message to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockScore).toHaveBeenCalledWith({
        traceId: 'trace-integration-test',
        name: 'user-feedback',
        value: 1,
        id: 'msg-integration-test-user-feedback',
      });

      socket.disconnect();
      server.close();

      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    });

    test('thumbs down feedback submits value 0', async () => {
      const port = 9103;

      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test-down';
      process.env.LANGFUSE_SECRET_KEY = 'sk-test-down';

      const feedbackPlugin = new FeedbackPlugin();
      const server = new UseAIServer({
        port,
        agents: { test: createTestAgent() },
        defaultAgent: 'test',
        plugins: [feedbackPlugin],
      });
      cleanup.trackServer(server);

      const socket = await cleanup.createTestClient(port);
      await new Promise(resolve => setTimeout(resolve, 100));

      socket.emit('message', {
        type: 'message_feedback',
        data: {
          messageId: 'msg-thumbs-down',
          traceId: 'trace-thumbs-down',
          feedback: 'downvote',
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockScore).toHaveBeenCalledWith({
        traceId: 'trace-thumbs-down',
        name: 'user-feedback',
        value: 0,
        id: 'msg-thumbs-down-user-feedback',
      });

      socket.disconnect();
      server.close();

      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    });

    test('null feedback (removal) does not submit to Langfuse', async () => {
      const port = 9104;

      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test-null';
      process.env.LANGFUSE_SECRET_KEY = 'sk-test-null';

      const feedbackPlugin = new FeedbackPlugin();
      const server = new UseAIServer({
        port,
        agents: { test: createTestAgent() },
        defaultAgent: 'test',
        plugins: [feedbackPlugin],
      });
      cleanup.trackServer(server);

      const socket = await cleanup.createTestClient(port);
      await new Promise(resolve => setTimeout(resolve, 100));

      socket.emit('message', {
        type: 'message_feedback',
        data: {
          messageId: 'msg-null-feedback',
          traceId: 'trace-null-feedback',
          feedback: null,
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockScore).not.toHaveBeenCalled();

      socket.disconnect();
      server.close();

      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    });

    test('feedback is not submitted when plugin is disabled', async () => {
      const port = 9105;

      // Ensure no credentials
      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;

      const feedbackPlugin = new FeedbackPlugin();
      const server = new UseAIServer({
        port,
        agents: { test: createTestAgent() },
        defaultAgent: 'test',
        plugins: [feedbackPlugin],
      });
      cleanup.trackServer(server);

      const socket = await cleanup.createTestClient(port);
      await new Promise(resolve => setTimeout(resolve, 100));

      socket.emit('message', {
        type: 'message_feedback',
        data: {
          messageId: 'msg-disabled',
          traceId: 'trace-disabled',
          feedback: 'upvote',
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockScore).not.toHaveBeenCalled();

      socket.disconnect();
      server.close();
    });
  });

  describe('RUN_FINISHED Event', () => {
    test('RUN_FINISHED event includes runId for feedback linking', async () => {
      const port = 9106;

      const server = new UseAIServer({
        port,
        agents: { test: createTestAgent() },
        defaultAgent: 'test',
      });
      cleanup.trackServer(server);

      const socket = await cleanup.createTestClient(port);

      // Set up event collection before sending message
      const eventsPromise = collectEventsUntil(socket, EventType.RUN_FINISHED);

      // Send a message to trigger AI response
      sendRunAgent(socket, {
        prompt: 'Hello',
      });

      // Wait for events including RUN_FINISHED
      const events = await eventsPromise;

      // Find RUN_FINISHED event
      const runFinishedEvent = events.find(e => e.type === EventType.RUN_FINISHED);
      expect(runFinishedEvent).toBeDefined();
      expect((runFinishedEvent as { runId?: string }).runId).toBeDefined();
      expect(typeof (runFinishedEvent as { runId?: string }).runId).toBe('string');

      socket.disconnect();
      server.close();
    });
  });

  describe('Feedback Update (Idempotency)', () => {
    test('updating feedback uses the same score ID', async () => {
      const port = 9107;

      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test-update';
      process.env.LANGFUSE_SECRET_KEY = 'sk-test-update';

      const feedbackPlugin = new FeedbackPlugin();
      const server = new UseAIServer({
        port,
        agents: { test: createTestAgent() },
        defaultAgent: 'test',
        plugins: [feedbackPlugin],
      });
      cleanup.trackServer(server);

      const socket = await cleanup.createTestClient(port);
      await new Promise(resolve => setTimeout(resolve, 100));

      // First feedback: thumbs up
      socket.emit('message', {
        type: 'message_feedback',
        data: {
          messageId: 'msg-update-test',
          traceId: 'trace-update-test',
          feedback: 'upvote',
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Update to thumbs down
      socket.emit('message', {
        type: 'message_feedback',
        data: {
          messageId: 'msg-update-test',
          traceId: 'trace-update-test',
          feedback: 'downvote',
        },
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockScore).toHaveBeenCalledTimes(2);

      // Both calls should use the same score ID
      const calls = mockScore.mock.calls as unknown as Array<[{ id: string; value: number }]>;
      expect(calls[0][0].id).toBe('msg-update-test-user-feedback');
      expect(calls[1][0].id).toBe('msg-update-test-user-feedback');

      // Values should be different
      expect(calls[0][0].value).toBe(1); // upvote
      expect(calls[1][0].value).toBe(0); // downvote

      socket.disconnect();
      server.close();

      delete process.env.LANGFUSE_PUBLIC_KEY;
      delete process.env.LANGFUSE_SECRET_KEY;
    });
  });
});
