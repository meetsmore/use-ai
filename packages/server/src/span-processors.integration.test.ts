/**
 * Integration tests for custom span processors.
 *
 * Verifies that custom SpanProcessor instances passed via UseAIServerConfig.spanProcessors
 * receive onStart/onEnd callbacks for AI SDK spans during an agent run.
 */

import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { EventType } from './types';
import { UseAIServer } from './server';
import { _resetTracing, type SpanProcessor } from './instrumentation';
import {
  collectEventsUntil,
  sendRunAgent,
  extractTextFromEvents,
} from '../test/test-utils';
import {
  createTestAgent,
  TestCleanupManager,
} from '../test/integration-test-utils';

const cleanup = new TestCleanupManager();

/**
 * Simple in-memory span processor for testing.
 * Records all spans it receives via onStart/onEnd.
 */
function createRecordingSpanProcessor() {
  const started: Array<{ traceId: string; attributes: Record<string, unknown> }> = [];
  const ended: unknown[] = [];

  const processor: SpanProcessor = {
    onStart(span) {
      started.push({
        traceId: span.spanContext().traceId,
        attributes: { ...span.attributes },
      });
    },
    onEnd(span) {
      ended.push(span);
    },
    shutdown() {
      return Promise.resolve();
    },
    forceFlush() {
      return Promise.resolve();
    },
  };

  return { processor, started, ended };
}

describe('Custom Span Processors', () => {
  const testPort = 9400;

  beforeAll(() => {
    _resetTracing();
  });

  afterAll(() => {
    cleanup.cleanup();
  });

  test('custom span processor receives spans from an agent run', async () => {
    const { processor, started, ended } = createRecordingSpanProcessor();

    const agent = createTestAgent('test-agent');
    const server = new UseAIServer({
      port: testPort,
      agents: { 'test-agent': agent },
      defaultAgent: 'test-agent',
      spanProcessors: [processor],
    });
    cleanup.trackServer(server);

    const socket = await cleanup.createTestClient(testPort);

    sendRunAgent(socket, {
      prompt: 'Hello',
      tools: [],
    });

    const events = await collectEventsUntil(socket, EventType.RUN_FINISHED);
    const text = extractTextFromEvents(events);

    // Agent responded
    expect(text).toBe('Default response');

    // Wait briefly for span processor callbacks to flush
    await new Promise(resolve => setTimeout(resolve, 200));

    // The span processor should have received at least one span
    expect(started.length).toBeGreaterThan(0);
    expect(ended.length).toBeGreaterThan(0);

    socket.disconnect();
  });
});
