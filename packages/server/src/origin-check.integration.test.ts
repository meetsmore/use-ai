import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import WebSocket from 'ws';
import { UseAIServer } from './server';
import { createServerConfig, TestCleanupManager } from '../test/integration-test-utils';
import { getFreePort } from '../test/ports';

/**
 * Security finding I2: the server must be able to refuse connections whose Origin
 * header is not in `allowedOrigins`, on both transports and both runtimes.
 * Without `allowedOrigins`, every origin connects, as before.
 */

const RUNTIMES: ('bun' | 'node')[] = ['bun', 'node'];
const TRANSPORTS: ('socketio' | 'websocket')[] = ['socketio', 'websocket'];

const ALLOWED = 'https://app.example.com';
const OTHER = 'https://evil.example.com';

function webSocketUrl(port: number, transport: 'socketio' | 'websocket'): string {
  return transport === 'socketio'
    ? `ws://localhost:${port}/socket.io/?EIO=4&transport=websocket`
    : `ws://localhost:${port}/`;
}

/** Resolves true when the WebSocket upgrade succeeds, false when the server refuses it. */
function webSocketOpens(url: string, origin?: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Bun's `ws` ignores the `origin` option, so the header is set directly.
    const ws = new WebSocket(url, origin ? { headers: { Origin: origin } } : {});
    const timeout = setTimeout(() => {
      ws.terminate();
      resolve(false);
    }, 3000);
    const finish = (opened: boolean) => {
      clearTimeout(timeout);
      ws.removeAllListeners();
      ws.on('error', () => {});
      if (opened) ws.close();
      else ws.terminate();
      resolve(opened);
    };
    ws.once('open', () => finish(true));
    ws.once('error', () => finish(false));
    ws.once('unexpected-response', () => finish(false));
    ws.once('close', () => finish(false));
  });
}

/** Status of a Socket.IO polling handshake sent with the given Origin. */
async function pollingHandshakeStatus(port: number, origin?: string, secFetchSite?: string): Promise<number> {
  const headers: Record<string, string> = origin ? { Origin: origin } : {};
  if (secFetchSite) headers['Sec-Fetch-Site'] = secFetchSite;
  const response = await fetch(`http://localhost:${port}/socket.io/?EIO=4&transport=polling`, { headers });
  await response.text();
  return response.status;
}

describe.each(RUNTIMES)('Origin check: %s runtime', (runtime) => {
  describe.each(TRANSPORTS)('%s transport', (transport) => {
    const cleanup = new TestCleanupManager();
    let restrictedPort: number;
    let openPort: number;

    beforeAll(async () => {
      restrictedPort = await getFreePort();
      openPort = await getFreePort();
      cleanup.trackServer(new UseAIServer({
        ...createServerConfig(restrictedPort),
        runtime,
        transport,
        allowedOrigins: [ALLOWED],
      }));
      cleanup.trackServer(new UseAIServer({
        ...createServerConfig(openPort),
        runtime,
        transport,
      }));
    });

    afterAll(() => {
      cleanup.cleanup();
    });

    test('accepts a WebSocket from an allowed origin', async () => {
      expect(await webSocketOpens(webSocketUrl(restrictedPort, transport), ALLOWED)).toBe(true);
    });

    test('refuses a WebSocket from another origin', async () => {
      expect(await webSocketOpens(webSocketUrl(restrictedPort, transport), OTHER)).toBe(false);
    });

    test('refuses a WebSocket without an Origin header', async () => {
      expect(await webSocketOpens(webSocketUrl(restrictedPort, transport))).toBe(false);
    });

    test('accepts any origin when allowedOrigins is not set', async () => {
      expect(await webSocketOpens(webSocketUrl(openPort, transport), OTHER)).toBe(true);
      expect(await webSocketOpens(webSocketUrl(openPort, transport))).toBe(true);
    });

    if (transport === 'socketio') {
      test('accepts a polling handshake from an allowed origin', async () => {
        expect(await pollingHandshakeStatus(restrictedPort, ALLOWED)).toBe(200);
      });

      test('refuses a polling handshake from another origin', async () => {
        expect(await pollingHandshakeStatus(restrictedPort, OTHER)).toBe(403);
      });

      test('refuses a polling handshake without an Origin header', async () => {
        expect(await pollingHandshakeStatus(restrictedPort)).toBe(403);
      });

      // Browsers do not send Origin on a same-origin GET, for example when the app and
      // the server share an origin behind a reverse proxy.
      test('accepts a polling handshake without Origin when Sec-Fetch-Site is same-origin', async () => {
        expect(await pollingHandshakeStatus(restrictedPort, undefined, 'same-origin')).toBe(200);
      });

      test.each(['same-site', 'cross-site', 'none'])(
        'refuses a polling handshake without Origin when Sec-Fetch-Site is %s',
        async (secFetchSite) => {
          expect(await pollingHandshakeStatus(restrictedPort, undefined, secFetchSite)).toBe(403);
        },
      );

      test('refuses a polling handshake from another origin even when Sec-Fetch-Site is same-origin', async () => {
        expect(await pollingHandshakeStatus(restrictedPort, OTHER, 'same-origin')).toBe(403);
      });
    }

    test('health endpoint does not check the origin', async () => {
      const response = await fetch(`http://localhost:${restrictedPort}/health`, { headers: { Origin: OTHER } });
      expect(response.status).toBe(200);
    });
  });
});
