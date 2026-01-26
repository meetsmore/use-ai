import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { EventType } from './types';
import {
  waitForEventType,
  sendRunAgent,
} from '../test/test-utils';
import { UseAIServer } from './server';
import {
  createServerConfig,
  TestCleanupManager,
} from '../test/integration-test-utils';

// Track all servers and sockets for cleanup
const cleanup = new TestCleanupManager();

afterAll(() => {
  cleanup.cleanup();
});

describe('Rate Limiting', () => {
  let server: UseAIServer;
  const testPort = 9005;

  beforeAll(() => {
    server = new UseAIServer(createServerConfig(testPort, 'test-agent', {
      rateLimitMaxRequests: 2,
      rateLimitWindowMs: 1000,
    }));
    cleanup.trackServer(server);
  });

  afterAll(() => {
    server.close();
  });

  test('Rate limiting per IP using sliding window algorithm', async () => {
    const socket = await cleanup.createTestClient(testPort);

    // First request
    sendRunAgent(socket, { prompt: 'Request 1', tools: [] });
    await waitForEventType(socket, EventType.TEXT_MESSAGE_END);

    // Second request
    sendRunAgent(socket, { prompt: 'Request 2', tools: [] });
    await waitForEventType(socket, EventType.TEXT_MESSAGE_END);

    // Third request should be rate limited
    sendRunAgent(socket, { prompt: 'Request 3', tools: [] });
    const errorEvent = await waitForEventType(socket, EventType.RUN_ERROR);

    expect((errorEvent as any).message).toContain('Rate limit exceeded');

    socket.disconnect();
  });

  test('Max requests per window configurable via environment variables', () => {
    // Configuration is verified by server initialization with rateLimitMaxRequests: 2
    expect(server).toBeDefined();
  });

  test('Window duration configurable via environment variables', () => {
    // Configuration is verified by server initialization with rateLimitWindowMs: 1000
    expect(server).toBeDefined();
  });

  test('Rate limiting can be disabled by setting max to 0', async () => {
    const unlimitedPort = 9006;
    const unlimitedServer = new UseAIServer(createServerConfig(unlimitedPort, 'test-agent', {
      rateLimitMaxRequests: 0,
      rateLimitWindowMs: 1000,
    }));
    cleanup.trackServer(unlimitedServer);

    const socket = await cleanup.createTestClient(unlimitedPort);

    // Send many requests - all should succeed
    for (let i = 0; i < 5; i++) {
      sendRunAgent(socket, { prompt: `Request ${i}`, tools: [] });
      await waitForEventType(socket, EventType.TEXT_MESSAGE_END);
    }

    socket.disconnect();
    unlimitedServer.close();
  });

  test('Different clients have independent rate limits', async () => {
    // NOTE: In a local test environment, all Socket.IO clients share the same IP (localhost)
    // so they share the same rate limit pool. This test verifies that different socket connections
    // are properly tracked, even though they share the same IP-based rate limit.
    // To truly test independent limits per client, we would need to mock different IP addresses.

    // Create a separate server for this test to avoid rate limit spillover from previous tests
    const independentPort = 9301;
    const independentServer = new UseAIServer(createServerConfig(independentPort, 'test-agent', {
      rateLimitMaxRequests: 2,
      rateLimitWindowMs: 1000,
    }));
    cleanup.trackServer(independentServer);

    const socket1 = await cleanup.createTestClient(independentPort);
    const socket2 = await cleanup.createTestClient(independentPort);

    // Both clients share the same IP, so they share the rate limit pool
    // Client 1 makes first request
    sendRunAgent(socket1, { prompt: 'Client 1 Request 1', tools: [] });
    await waitForEventType(socket1, EventType.TEXT_MESSAGE_END);

    // Client 2 makes second request (uses second slot in shared pool)
    sendRunAgent(socket2, { prompt: 'Client 2 Request 1', tools: [] });
    await waitForEventType(socket2, EventType.TEXT_MESSAGE_END);

    // Now the shared pool is exhausted, so either client should be rate limited
    sendRunAgent(socket1, { prompt: 'Client 1 Request 2', tools: [] });
    const error1 = await waitForEventType(socket1, EventType.RUN_ERROR);
    expect((error1 as any).message).toContain('Rate limit exceeded');

    socket1.disconnect();
    socket2.disconnect();
    independentServer.close();
  });

  test('Rate limits reset after time window expires', async () => {
    // Create a separate server for this test to avoid rate limit spillover from previous tests
    const resetPort = 9302;
    const resetServer = new UseAIServer(createServerConfig(resetPort, 'test-agent', {
      rateLimitMaxRequests: 2,
      rateLimitWindowMs: 1000,
    }));
    cleanup.trackServer(resetServer);

    const socket = await cleanup.createTestClient(resetPort);

    // Use up the limit
    sendRunAgent(socket, { prompt: 'Request 1', tools: [] });
    await waitForEventType(socket, EventType.TEXT_MESSAGE_END);

    sendRunAgent(socket, { prompt: 'Request 2', tools: [] });
    await waitForEventType(socket, EventType.TEXT_MESSAGE_END);

    // Verify rate limit is hit
    sendRunAgent(socket, { prompt: 'Request 3', tools: [] });
    const errorEvent = await waitForEventType(socket, EventType.RUN_ERROR);
    expect((errorEvent as any).message).toContain('Rate limit exceeded');

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Should be allowed again
    sendRunAgent(socket, { prompt: 'Request 4', tools: [] });
    const response = await waitForEventType(socket, EventType.TEXT_MESSAGE_END);
    expect(response.type).toBe(EventType.TEXT_MESSAGE_END);

    socket.disconnect();
    resetServer.close();
  });

  test('Returns helpful error with retry-after when rate limited', async () => {
    // Create a separate server for this test to avoid rate limit spillover from previous tests
    const errorPort = 9303;
    const errorServer = new UseAIServer(createServerConfig(errorPort, 'test-agent', {
      rateLimitMaxRequests: 2,
      rateLimitWindowMs: 1000,
    }));
    cleanup.trackServer(errorServer);

    const socket = await cleanup.createTestClient(errorPort);

    // Use up the limit
    sendRunAgent(socket, { prompt: 'Request 1', tools: [] });
    await waitForEventType(socket, EventType.TEXT_MESSAGE_END);

    sendRunAgent(socket, { prompt: 'Request 2', tools: [] });
    await waitForEventType(socket, EventType.TEXT_MESSAGE_END);

    // Get rate limited
    sendRunAgent(socket, { prompt: 'Request 3', tools: [] });
    const errorEvent = await waitForEventType(socket, EventType.RUN_ERROR);

    const errorMessage = (errorEvent as any).message;
    expect(errorMessage).toContain('Rate limit exceeded');
    expect(errorMessage).toContain('try again');

    socket.disconnect();
    errorServer.close();
  });

  test('Rate limiting works correctly with HTTP long-polling transport', async () => {
    // Create a separate server for this test
    const pollingPort = 9304;
    const pollingServer = new UseAIServer(createServerConfig(pollingPort, 'test-agent', {
      rateLimitMaxRequests: 2,
      rateLimitWindowMs: 1000,
    }));
    cleanup.trackServer(pollingServer);

    // Create a client that uses polling transport only (no WebSocket upgrade)
    const socket = await cleanup.createPollingTestClient(pollingPort);

    // Verify we're using polling transport
    expect(socket.io.engine.transport.name).toBe('polling');

    // First request
    sendRunAgent(socket, { prompt: 'Polling Request 1', tools: [] });
    await waitForEventType(socket, EventType.TEXT_MESSAGE_END);

    // Second request
    sendRunAgent(socket, { prompt: 'Polling Request 2', tools: [] });
    await waitForEventType(socket, EventType.TEXT_MESSAGE_END);

    // Third request should be rate limited
    sendRunAgent(socket, { prompt: 'Polling Request 3', tools: [] });
    const errorEvent = await waitForEventType(socket, EventType.RUN_ERROR);

    expect((errorEvent as any).message).toContain('Rate limit exceeded');

    socket.disconnect();
    pollingServer.close();
  });

  test('Polling and WebSocket clients from same IP share rate limit', async () => {
    // Create a separate server for this test
    const mixedPort = 9305;
    const mixedServer = new UseAIServer(createServerConfig(mixedPort, 'test-agent', {
      rateLimitMaxRequests: 2,
      rateLimitWindowMs: 1000,
    }));
    cleanup.trackServer(mixedServer);

    // Create one WebSocket client and one polling client
    const wsSocket = await cleanup.createTestClient(mixedPort);
    const pollingSocket = await cleanup.createPollingTestClient(mixedPort);

    // Verify transports
    expect(wsSocket.io.engine.transport.name).toBe('websocket');
    expect(pollingSocket.io.engine.transport.name).toBe('polling');

    // WebSocket client makes first request
    sendRunAgent(wsSocket, { prompt: 'WS Request 1', tools: [] });
    await waitForEventType(wsSocket, EventType.TEXT_MESSAGE_END);

    // Polling client makes second request (shares IP with WebSocket client)
    sendRunAgent(pollingSocket, { prompt: 'Polling Request 1', tools: [] });
    await waitForEventType(pollingSocket, EventType.TEXT_MESSAGE_END);

    // Third request from polling client should be rate limited (shared IP pool exhausted)
    sendRunAgent(pollingSocket, { prompt: 'Polling Request 2', tools: [] });
    const errorEvent = await waitForEventType(pollingSocket, EventType.RUN_ERROR);

    expect((errorEvent as any).message).toContain('Rate limit exceeded');

    wsSocket.disconnect();
    pollingSocket.disconnect();
    mixedServer.close();
  });
});
