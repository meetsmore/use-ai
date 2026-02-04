import type { Server as SocketIOServer } from 'socket.io';
import { Server as BunEngine } from '@socket.io/bun-engine';
import type { RuntimeAdapter, RuntimeServerConfig, RuntimeServerHandle } from '../types';
import { resolveCorsHeaders, resolvePreflightHeaders } from '../cors';

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
    this.engine.on('connection', (engineSocket, req, bunServer) => {
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

        // Helper to create response with CORS headers
        const corsHeaders = resolveCorsHeaders(requestOrigin, config.cors);

        // Health check endpoint
        if (url.pathname === '/health') {
          return new Response(JSON.stringify({ status: 'ok' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        // Socket.IO path
        if (url.pathname.startsWith('/socket.io/')) {
          const response = await handler(req, server);

          // Add CORS headers to Socket.IO responses
          if (response && Object.keys(corsHeaders).length > 0) {
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
      websocket: websocketHandler,
    });

    return {
      stop: () => {
        bunServer.stop();
      },
      server: bunServer,
    };
  }
}
