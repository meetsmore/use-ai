import type { Server as SocketIOServer } from 'socket.io';
import { Server as BunEngine } from '@socket.io/bun-engine';
import type { RuntimeAdapter, RuntimeListener, RuntimeServerConfig, RuntimeServerHandle, WebSocketListener } from '../types';
import { resolveCorsHeaders, resolvePreflightHeaders } from './cors';
import { BunRawWebSocket, type BunWebSocketData } from './rawWebSocket';

type ServeOptions = Parameters<typeof Bun.serve>[0];
type BunServer = Parameters<NonNullable<ServeOptions['fetch']>>[1];
type WebSocketHandler = NonNullable<ServeOptions['websocket']>;

/** The part of the HTTP server a listener owns. */
interface ListenerHandlers {
  /** Requests under this path go to `upgrade`; everything else is 404. */
  path: string;
  /** Answers the request, or returns undefined once the request was upgraded. */
  upgrade(req: Request, server: BunServer): Promise<Response | undefined>;
  websocket: WebSocketHandler;
}

/**
 * Runtime adapter for Bun.
 * Serves Socket.IO through @socket.io/bun-engine, or a plain WebSocket through Bun.serve's
 * own upgrade, on one HTTP server.
 */
export class BunRuntimeAdapter implements RuntimeAdapter {
  readonly name = 'bun' as const;

  private engine: BunEngine | null = null;

  createServer(listener: RuntimeListener, config: RuntimeServerConfig): RuntimeServerHandle {
    const handlers =
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

        if (!url.pathname.startsWith(handlers.path)) {
          return new Response('Not Found', { status: 404, headers: corsHeaders });
        }

        const response = await handlers.upgrade(req, server);
        if (!response || Object.keys(corsHeaders).length === 0) return response;

        const headers = new Headers(response.headers);
        for (const [key, value] of Object.entries(corsHeaders)) {
          headers.set(key, value);
        }
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      },
      websocket: handlers.websocket,
    });

    return {
      stop: () => {
        bunServer.stop();
      },
      server: bunServer,
    };
  }

  private socketIOHandlers(io: SocketIOServer, config: RuntimeServerConfig): ListenerHandlers {
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
      path: '/socket.io/',
      upgrade: (req, server) => handleRequest(req, server as never),
      websocket: this.engine.handler().websocket as unknown as WebSocketHandler,
    };
  }

  private webSocketHandlers(onConnection: WebSocketListener['onConnection']): ListenerHandlers {
    const dataOf = (ws: { data: unknown }) => ws.data as BunWebSocketData;
    return {
      path: '/',
      upgrade: async (req, server) => {
        if (new URL(req.url).pathname !== '/') return new Response('Not Found', { status: 404 });
        const data: BunWebSocketData = { remoteAddress: server.requestIP(req)?.address };
        if (server.upgrade(req, { data })) return undefined;
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      },
      websocket: {
        open: (ws) => {
          const data = dataOf(ws);
          data.connection = new BunRawWebSocket(ws, data.remoteAddress);
          onConnection(data.connection);
        },
        message: (ws, message) => {
          if (typeof message === 'string') dataOf(ws).connection?.receiveMessage(message);
        },
        close: (ws) => {
          dataOf(ws).connection?.receiveClose();
        },
      },
    };
  }
}
