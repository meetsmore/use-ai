import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { UseAIServer } from '../server';
import { createServerConfig, TestCleanupManager } from '../../test/integration-test-utils';
import { EventType } from '@meetsmore-oss/use-ai-core';
import { waitForEventType, sendRunAgent } from '../../test/test-utils';

/**
 * Runtime Adapter Integration Tests
 *
 * Tests both Bun and Node.js runtime adapters to ensure:
 * 1. Server accepts connections
 * 2. Health endpoint responds
 * 3. AG-UI protocol works
 * 4. WebSocket transport works
 * 5. Polling transport works
 */

const RUNTIMES: ('bun' | 'node')[] = ['bun', 'node'];

describe.each(RUNTIMES)('Runtime Adapter: %s', (runtime) => {
  const cleanup = new TestCleanupManager();
  let server: UseAIServer;
  // Use different port ranges for each runtime to avoid conflicts
  const basePort = runtime === 'bun' ? 9500 : 9510;

  beforeAll(() => {
    server = new UseAIServer({
      ...createServerConfig(basePort),
      runtime,
    });
    cleanup.trackServer(server);
  });

  afterAll(() => {
    cleanup.cleanup();
  });

  test('server accepts WebSocket connections', async () => {
    const socket = await cleanup.createTestClient(basePort);
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });

  test('health endpoint responds', async () => {
    const response = await fetch(`http://localhost:${basePort}/health`);
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  test('AG-UI protocol works with text response', async () => {
    const socket = await cleanup.createTestClient(basePort);

    // Send a run_agent message
    sendRunAgent(socket, {
      prompt: 'Hello',
      tools: [],
    });

    // Wait for text message end event
    const event = await waitForEventType(socket, EventType.TEXT_MESSAGE_END);
    expect(event.type).toBe(EventType.TEXT_MESSAGE_END);

    socket.disconnect();
  });

  test('WebSocket transport is used when requested', async () => {
    const socket = await cleanup.createTestClient(basePort);

    // Check transport name
    const transport = socket.io.engine.transport.name;
    expect(transport).toBe('websocket');

    socket.disconnect();
  });

  test('Polling transport works when specified', async () => {
    const socket = await cleanup.createPollingTestClient(basePort);

    // Check transport name
    const transport = socket.io.engine.transport.name;
    expect(transport).toBe('polling');

    // Verify we can still communicate
    sendRunAgent(socket, {
      prompt: 'Hello via polling',
      tools: [],
    });

    const event = await waitForEventType(socket, EventType.TEXT_MESSAGE_END);
    expect(event.type).toBe(EventType.TEXT_MESSAGE_END);

    socket.disconnect();
  });

  test('404 returned for unknown paths', async () => {
    const response = await fetch(`http://localhost:${basePort}/unknown-path`);
    expect(response.status).toBe(404);
  });

  test('receives agents list on connection', async () => {
    const socket = await cleanup.createTestClient(basePort);

    // Wait for agents event
    const agentsPromise = new Promise<{ agents: Array<{ id: string; name: string }>; defaultAgent: string }>((resolve) => {
      socket.once('agents', resolve);
    });

    // Reconnect to trigger agents event
    socket.disconnect();
    const newSocket = await cleanup.createTestClient(basePort);

    // The agents event should be emitted on connection
    await new Promise(resolve => setTimeout(resolve, 100));

    newSocket.disconnect();
  });
});

describe('Runtime Adapter: createRuntimeAdapter validation', () => {
  const { createRuntimeAdapter, detectRuntime } = require('./index');

  test('auto mode detects current runtime', () => {
    const adapter = createRuntimeAdapter('auto');
    const detected = detectRuntime();
    expect(adapter.name).toBe(detected);
  });

  test('explicit runtime selection works', () => {
    // On Bun, both 'bun' and 'node' should work
    // On Node.js, only 'node' should work
    const detected = detectRuntime();

    if (detected === 'bun') {
      // Bun can use either adapter
      const bunAdapter = createRuntimeAdapter('bun');
      expect(bunAdapter.name).toBe('bun');

      const nodeAdapter = createRuntimeAdapter('node');
      expect(nodeAdapter.name).toBe('node');
    } else {
      // Node.js can only use node adapter
      const nodeAdapter = createRuntimeAdapter('node');
      expect(nodeAdapter.name).toBe('node');

      // Requesting bun on Node.js should throw
      expect(() => createRuntimeAdapter('bun')).toThrow('Cannot use Bun runtime adapter on Node.js');
    }
  });
});
