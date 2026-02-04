import type { Server as SocketIOServer } from 'socket.io';
import { Server as BunEngine } from '@socket.io/bun-engine';
import type {
  RuntimeAdapter,
  RuntimeServerConfig,
  RuntimeServerHandle,
  ConnectionContext,
} from '../types';
import { addCorsHeaders } from './cors';

/**
 * Runtime adapter for Bun.
 * Uses @socket.io/bun-engine for native Bun WebSocket support.
 */
export class BunRuntimeAdapter implements RuntimeAdapter {
  readonly name = 'bun' as const;

  private engine: BunEngine | null = null;

  createServer(io: SocketIOServer, config: RuntimeServerConfig): RuntimeServerHandle {
    // Create Bun-native engine
    this.engine = new BunEngine({
      path: '/socket.io/',
    });

    // Capture client IP for polling transport at engine connection time
    // For WebSocket, BunWebSocket.remoteAddress is available directly (no need to store here)
    // For polling, server.requestIP() works because there's no WebSocket upgrade
    this.engine.on('connection', (engineSocket, req, bunServer) => {
      // Only store for polling - WebSocket uses BunWebSocket.remoteAddress
      if (engineSocket.transport?.name === 'polling' && config.onPollingConnection) {
        const clientIp = bunServer.requestIP(req);
        if (clientIp) {
          config.onPollingConnection(engineSocket.id, clientIp.address);
        }
      }
    });

    // Bind Socket.IO to Bun engine
    io.bind(this.engine);

    const handler = this.engine.handleRequest.bind(this.engine);
    const websocketHandler = this.engine.handler().websocket;

    // Start Bun server
    const bunServer = Bun.serve({
      port: config.port,
      idleTimeout: config.idleTimeout ?? 30,
      fetch: async (req: Request, server) => {
        const url = new URL(req.url);

        // Handle CORS preflight
        if (req.method === 'OPTIONS' && config.cors) {
          const methods = config.cors.methods ?? ['GET', 'POST'];
          const requestedHeaders = req.headers.get('Access-Control-Request-Headers');

          return new Response(null, {
            status: 204,
            headers: addCorsHeaders(req, {
              'Access-Control-Allow-Methods': Array.isArray(methods) ? methods.join(',') : methods,
              ...(requestedHeaders && { 'Access-Control-Allow-Headers': requestedHeaders }),
              'Content-Length': '0',
            }, config.cors),
          });
        }

        // Health check endpoint
        if (url.pathname === '/health') {
          return new Response(JSON.stringify({ status: 'ok' }), {
            headers: addCorsHeaders(req, { 'Content-Type': 'application/json' }, config.cors),
          });
        }

        // Socket.IO path
        if (url.pathname.startsWith('/socket.io/')) {
          const response = await handler(req, server);

          // Add CORS headers to Socket.IO responses
          if (response && config.cors) {
            const corsHeaders = addCorsHeaders(req, {}, config.cors);
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
          }
          return response;
        }

        return new Response('Not Found', { status: 404, headers: addCorsHeaders(req, {}, config.cors) });
      },
      websocket: websocketHandler,
    });

    return {
      stop: () => {
        bunServer.stop();
      },
      server: bunServer,
    };
  }

  getClientIp(context: ConnectionContext): string | undefined {
    // For WebSocket transport, BunWebSocket.remoteAddress is available directly
    if (context.conn.transport.socket?.remoteAddress) {
      return context.conn.transport.socket.remoteAddress;
    }
    // For polling transport, use the stored IP from pollingClientIps map
    if (context.pollingClientIps) {
      return context.pollingClientIps.get(context.conn.id);
    }
    return undefined;
  }
}
