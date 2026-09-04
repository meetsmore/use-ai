import { Server as BunEngine } from '@socket.io/bun-engine';
import type { RuntimeAdapter, RuntimeListener, RuntimeServerConfig, RuntimeServerHandle } from '../types';
import { resolveCorsHeaders, resolvePreflightHeaders } from './cors';
import { BunRawWebSocket, type RawWebSocketData } from './rawWebSocket';

type BunServer = Parameters<NonNullable<Parameters<typeof Bun.serve>[0]['fetch']>>[1];
type WebSocketHandler = NonNullable<Parameters<typeof Bun.serve>[0]['websocket']>;

/**
 * Runtime adapter for Bun.
 * Serves Socket.IO through @socket.io/bun-engine, or a plain WebSocket through Bun.serve's
 * own upgrade, on one HTTP server.
 */
export class BunRuntimeAdapter implements RuntimeAdapter {
  readonly name = 'bun' as const;

  private engine: BunEngine | null = null;

  createServer(listener: RuntimeListener, config: RuntimeServerConfig): RuntimeServerHandle {
    const { upgrade, websocket } =
      listener.transport === 'socketio'
        ? this.socketIOHandlers(listener.io, config)
        : this.webSocketHandlers(listener.onConnection);

    const bunServer = Bun.serve({
      port: config.port,
      idleTimeout: config.idleTimeout ?? 30,
      fetch: async (req: Request, server) => {
        const url = new URL(req.url);
        const requestOrigin = req.headers.get('Origin') || undefined;

        // Handle CORS preflight
        if (req.method === 'OPTIONS' && config.cors) {
          const requestedHeaders = req.headers.get('Access-Control-Request-Headers') || undefined;
          const headers = resolvePreflightHeaders(requestOrigin, requestedHeaders, config.cors);
          return new Response(null, {
            status: 204,
            headers: { ...headers, 'Content-Length': '0' },
          });
        }

        const corsHeaders = resolveCorsHeaders(requestOrigin, config.cors);

        // Health check endpoint
        if (url.pathname === '/health') {
          return new Response(JSON.stringify({ status: 'ok' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const response = await upgrade(req, server, url);
        if (response === null) return undefined;
        if (response) {
          // Add CORS headers to the listener's responses
          if (Object.keys(corsHeaders).length > 0) {
            const newHeaders = new Headers(response.headers);
            for (const [key, value] of Object.entries(corsHeaders)) {
              newHeaders.set(key, value);
            }
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: newHeaders,
            });
          }
          return response;
        }

        return new Response('Not Found', { status: 404, headers: corsHeaders });
      },
      websocket,
    });

    return {
      stop: () => {
        bunServer.stop();
      },
      server: bunServer,
    };
  }

  /**
   * @returns `upgrade` yields a Response to send, `null` once the request was upgraded,
   *   or `undefined` when the path is not the listener's.
   */
  private socketIOHandlers(io: RuntimeListener extends infer L ? (L extends { io: infer I } ? I : never) : never, config: RuntimeServerConfig) {
    this.engine = new BunEngine({
      path: '/socket.io/',
      maxHttpBufferSize: config.maxHttpBufferSize,
    });

    // Capture client IP for polling transport at engine connection time
    this.engine.on('connection', (engineSocket, req, bunServer) => {
      if (engineSocket.transport?.name === 'polling' && config.onPollingConnection) {
        const clientIp = bunServer.requestIP(req);
        if (clientIp) {
          config.onPollingConnection(engineSocket.id, clientIp.address);
        }
      }
    });

    io.bind(this.engine);

    const handleRequest = this.engine.handleRequest.bind(this.engine);
    return {
      upgrade: async (req: Request, server: BunServer, url: URL): Promise<Response | null | undefined> => {
        if (!url.pathname.startsWith('/socket.io/')) return undefined;
        // The engine returns undefined once it has upgraded the request itself.
        return (await handleRequest(req, server as never)) ?? null;
      },
      websocket: this.engine.handler().websocket as unknown as WebSocketHandler,
    };
  }

  private webSocketHandlers(onConnection: (connection: BunRawWebSocket) => void) {
    const sockets = new WeakMap<object, BunRawWebSocket>();
    const websocket: WebSocketHandler = {
      open: (ws) => {
        const { remoteAddress } = ws.data as RawWebSocketData;
        const connection = new BunRawWebSocket(ws, remoteAddress);
        sockets.set(ws, connection);
        onConnection(connection);
      },
      message: (ws, message) => {
        sockets.get(ws)?.receiveMessage(
          typeof message === 'string' ? message : new TextDecoder().decode(message),
        );
      },
      close: (ws) => {
        sockets.get(ws)?.receiveClose();
        sockets.delete(ws);
      },
    };

    return {
      upgrade: async (req: Request, server: BunServer, url: URL): Promise<Response | null | undefined> => {
        if (url.pathname !== '/') return undefined;
        const data: RawWebSocketData = { remoteAddress: server.requestIP(req)?.address };
        if (server.upgrade(req, { data })) return null;
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      },
      websocket,
    };
  }
}
