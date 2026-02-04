import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'http';
import type { Server as SocketIOServer } from 'socket.io';
import type { RuntimeServerConfig, RuntimeServerHandle } from '../types';
import { BaseRuntimeAdapter } from '../BaseRuntimeAdapter';
import { resolveCorsHeaders, resolvePreflightHeaders } from '../cors';

/**
 * Sets CORS headers on a Node.js HTTP response.
 */
function setCorsHeaders(headers: Record<string, string>, res: ServerResponse): void {
  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      res.setHeader(key, value);
    }
  }
}

/**
 * Handles CORS preflight OPTIONS request.
 * Returns true if the request was handled, false otherwise.
 */
function handleCorsPreflight(
  req: IncomingMessage,
  res: ServerResponse,
  config: RuntimeServerConfig
): boolean {
  if (req.method !== 'OPTIONS' || !config.cors) {
    return false;
  }

  const requestOrigin = req.headers.origin;
  const requestedHeaders = req.headers['access-control-request-headers'];
  const headers = resolvePreflightHeaders(
    requestOrigin,
    typeof requestedHeaders === 'string' ? requestedHeaders : undefined,
    config.cors
  );

  setCorsHeaders(headers, res);
  res.setHeader('Content-Length', '0');
  res.statusCode = 204;
  res.end();
  return true;
}

/**
 * Runtime adapter for Node.js.
 * Uses http.createServer with standard Socket.IO integration.
 */
export class NodeRuntimeAdapter extends BaseRuntimeAdapter {
  readonly name = 'node' as const;

  createServer(io: SocketIOServer, config: RuntimeServerConfig): RuntimeServerHandle {
    // Create Node.js HTTP server
    const httpServer: HttpServer = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${config.port}`);
      const requestOrigin = req.headers.origin;

      // Handle CORS preflight
      if (handleCorsPreflight(req, res, config)) {
        return;
      }

      // Get CORS headers for non-preflight requests
      const corsHeaders = resolveCorsHeaders(requestOrigin, config.cors);

      // Health check endpoint
      if (url.pathname === '/health') {
        setCorsHeaders(corsHeaders, res);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // Let Socket.IO handle /socket.io/ paths
      // Other paths return 404
      if (!url.pathname.startsWith('/socket.io/')) {
        setCorsHeaders(corsHeaders, res);
        res.statusCode = 404;
        res.end('Not Found');
      }
      // Socket.IO will handle the request via its internal listeners
    });

    // Attach Socket.IO to the HTTP server
    io.attach(httpServer, {
      transports: ['polling', 'websocket'],
      maxHttpBufferSize: config.maxHttpBufferSize,
      cors: config.cors ? {
        origin: config.cors.origin === true ? '*' : config.cors.origin,
        methods: config.cors.methods ?? ['GET', 'POST'],
        credentials: config.cors.credentials,
      } : undefined,
    });

    // Capture client IP for polling connections
    if (config.onPollingConnection) {
      const engine = (io as unknown as { engine?: { on?: (event: string, handler: (socket: { id: string; transport?: { name: string }; request?: { socket?: { remoteAddress?: string } }; headers?: { 'x-forwarded-for'?: string } }) => void) => void } }).engine;
      if (engine?.on) {
        engine.on('connection', (socket) => {
          if (socket.transport?.name === 'polling') {
            const xForwardedFor = socket.headers?.['x-forwarded-for'];
            const ip = typeof xForwardedFor === 'string'
              ? xForwardedFor.split(',')[0].trim()
              : socket.request?.socket?.remoteAddress;
            if (ip) {
              config.onPollingConnection!(socket.id, ip);
            }
          }
        });
      }
    }

    // Start listening
    httpServer.listen(config.port);

    return {
      stop: () => {
        httpServer.close();
      },
      server: httpServer,
    };
  }
}
