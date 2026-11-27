import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import WebSocket from 'ws';
import { io, type Socket } from 'socket.io-client';
import { UseAIServer } from './server';
import type { ClientSession } from './agents/types';
import { waitForConnection } from '../test/test-utils';
import { createServerConfig, TestCleanupManager } from '../test/integration-test-utils';

/**
 * Security finding M2: a client can write any value in `X-Forwarded-For`, so the server never
 * takes a client address from it. The session address is the peer of the connection, on both
 * runtimes and every transport.
 */

const RUNTIMES: ('bun' | 'node')[] = ['bun', 'node'];
type Connect = 'socketio-websocket' | 'socketio-polling' | 'websocket';
const CONNECTS: Connect[] = ['socketio-websocket', 'socketio-polling', 'websocket'];

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
    const port = nextPort++;
    let server: UseAIServer;

    beforeAll(() => {
      server = new UseAIServer({ ...createServerConfig(port), runtime, transport: how === 'websocket' ? 'websocket' : 'socketio' });
      cleanup.trackServer(server);
    });

    afterAll(() => {
      cleanup.cleanup();
    });

    test('ignores X-Forwarded-For and uses the peer address', async () => {
      const before = sessionIds(server);
      const close = await connect(port, how, { 'X-Forwarded-For': '203.0.113.9, 198.51.100.7' });
      expect(await newSessionIp(server, before)).toMatch(LOOPBACK);
      close();
    });
  });
});
