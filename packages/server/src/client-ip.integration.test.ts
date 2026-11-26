import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import WebSocket from 'ws';
import { io, type Socket } from 'socket.io-client';
import { UseAIServer } from './server';
import { EventType } from './types';
import type { ClientSession } from './agents/types';
import { waitForConnection, waitForEventType, sendRunAgent } from '../test/test-utils';
import { createServerConfig, TestCleanupManager } from '../test/integration-test-utils';

/**
 * Security finding M2: behind a load balancer, the peer of every connection is the load
 * balancer, so a per-address rate limit shared one count among all users. With
 * `trustedProxyCount`, the server takes the client address from `X-Forwarded-For`, read from
 * the right, on both runtimes and every transport. A client-written entry at the left is
 * never used. Without `trustedProxyCount`, the header is ignored on both runtimes.
 */

const RUNTIMES: ('bun' | 'node')[] = ['bun', 'node'];
type Connect = 'socketio-websocket' | 'socketio-polling' | 'websocket';
const CONNECTS: Connect[] = ['socketio-websocket', 'socketio-polling', 'websocket'];

// What a client behind one ALB sends: its own forged entry, then the address the ALB appended.
const FORGED = '203.0.113.9';
const CLIENT = '198.51.100.7';
const XFF = `${FORGED}, ${CLIENT}`;

const LOOPBACK = /^(::ffff:)?127\.0\.0\.1$|^::1$/;

function sessionIds(server: UseAIServer): Set<string> {
  return new Set((server['clients'] as Map<string, ClientSession>).keys());
}

/** Waits for a session that was not in `before` and returns its address. */
async function newSessionIp(server: UseAIServer, before: Set<string>): Promise<string> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    for (const [id, session] of server['clients'] as Map<string, ClientSession>) {
      if (!before.has(id)) return session.ipAddress;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('no new session');
}

/** Opens a connection the given way with the given headers, and returns a closer. */
async function connect(port: number, how: Connect, headers: Record<string, string>): Promise<() => void> {
  if (how === 'websocket') {
    const ws = new WebSocket(`ws://localhost:${port}/`, { headers });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return () => ws.close();
  }
  const socket: Socket = io(`http://localhost:${port}`, {
    transports: [how === 'socketio-polling' ? 'polling' : 'websocket'],
    upgrade: false,
    extraHeaders: headers,
  });
  await waitForConnection(socket);
  return () => socket.disconnect();
}

let nextPort = 9700;

describe.each(RUNTIMES)('Client address: %s runtime', (runtime) => {
  describe.each(CONNECTS)('%s', (how) => {
    const cleanup = new TestCleanupManager();
    const transport = how === 'websocket' ? 'websocket' : 'socketio';
    const behindProxyPort = nextPort++;
    const directPort = nextPort++;
    let behindProxy: UseAIServer;
    let direct: UseAIServer;

    beforeAll(() => {
      behindProxy = new UseAIServer({ ...createServerConfig(behindProxyPort), runtime, transport, trustedProxyCount: 1 });
      direct = new UseAIServer({ ...createServerConfig(directPort), runtime, transport });
      cleanup.trackServer(behindProxy);
      cleanup.trackServer(direct);
    });

    afterAll(() => {
      cleanup.cleanup();
    });

    test('with trustedProxyCount 1, uses the rightmost X-Forwarded-For entry, not the forged one', async () => {
      const before = sessionIds(behindProxy);
      const close = await connect(behindProxyPort, how, { 'X-Forwarded-For': XFF });
      expect(await newSessionIp(behindProxy, before)).toBe(CLIENT);
      close();
    });

    test('with trustedProxyCount 1 and no X-Forwarded-For, uses the peer address', async () => {
      const before = sessionIds(behindProxy);
      const close = await connect(behindProxyPort, how, {});
      expect(await newSessionIp(behindProxy, before)).toMatch(LOOPBACK);
      close();
    });

    test('without trustedProxyCount, ignores X-Forwarded-For', async () => {
      const before = sessionIds(direct);
      const close = await connect(directPort, how, { 'X-Forwarded-For': XFF });
      expect(await newSessionIp(direct, before)).toMatch(LOOPBACK);
      close();
    });
  });
});

describe('Rate limit behind a proxy', () => {
  const cleanup = new TestCleanupManager();
  const port = nextPort++;

  beforeAll(() => {
    cleanup.trackServer(new UseAIServer({
      ...createServerConfig(port),
      rateLimitMaxRequests: 1,
      rateLimitWindowMs: 60_000,
      trustedProxyCount: 1,
    }));
  });

  afterAll(() => {
    cleanup.cleanup();
  });

  async function client(xff: string): Promise<Socket> {
    const socket = io(`http://localhost:${port}`, { transports: ['websocket'], extraHeaders: { 'X-Forwarded-For': xff } });
    await waitForConnection(socket);
    cleanup.trackSocket(socket);
    return socket;
  }

  test('one client over its limit does not stop another client behind the same proxy', async () => {
    const a = await client(`10.0.0.1, ${CLIENT}`);
    sendRunAgent(a, { prompt: 'first', tools: [] });
    await waitForEventType(a, EventType.TEXT_MESSAGE_END);
    sendRunAgent(a, { prompt: 'second', tools: [] });
    const limited = await waitForEventType(a, EventType.RUN_ERROR);
    expect((limited as { message: string }).message).toContain('Rate limit exceeded');

    // Same forged entry at the left, different address appended by the proxy.
    const b = await client(`10.0.0.1, ${FORGED}`);
    sendRunAgent(b, { prompt: 'first', tools: [] });
    const event = await waitForEventType(b, EventType.TEXT_MESSAGE_END);
    expect(event.type).toBe(EventType.TEXT_MESSAGE_END);
  });

  test('changing the forged entry does not give a client a new count', async () => {
    const appended = '192.0.2.77';
    const first = await client(`192.0.2.50, ${appended}`);
    sendRunAgent(first, { prompt: 'first', tools: [] });
    await waitForEventType(first, EventType.TEXT_MESSAGE_END);

    const forgedAgain = await client(`192.0.2.51, ${appended}`);
    sendRunAgent(forgedAgain, { prompt: 'again', tools: [] });
    const limited = await waitForEventType(forgedAgain, EventType.RUN_ERROR);
    expect((limited as { message: string }).message).toContain('Rate limit exceeded');
  });
});

describe('trustedProxyCount validation', () => {
  test.each([-1, 1.5, Number.NaN])('refuses %p', (value) => {
    expect(() => new UseAIServer({ ...createServerConfig(nextPort++), trustedProxyCount: value })).toThrow(
      'trustedProxyCount must be a non-negative integer',
    );
  });
});
