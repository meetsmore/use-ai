import { createServer, type Server as HttpServer } from 'http';
import type { Server as SocketIOServer } from 'socket.io';
import type {
  RuntimeAdapter,
  RuntimeServerConfig,
  RuntimeServerHandle,
  ConnectionContext,
} from '../types';
import { setCorsHeaders, handleCorsPreflight } from './cors';

/**
 * Runtime adapter for Node.js.
 * Uses http.createServer with standard Socket.IO integration.
 */
export class NodeRuntimeAdapter implements RuntimeAdapter {
  readonly name = 'node' as const;

  createServer(io: SocketIOServer, config: RuntimeServerConfig): RuntimeServerHandle {
    // Create Node.js HTTP server
    const httpServer: HttpServer = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${config.port}`);

      // Handle CORS preflight
      if (handleCorsPreflight(req, res, config.cors)) {
        return;
      }

      // Health check endpoint
      if (url.pathname === '/health') {
        setCorsHeaders(req, res, config.cors);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // Let Socket.IO handle /socket.io/ paths
      // Other paths return 404
      if (!url.pathname.startsWith('/socket.io/')) {
        setCorsHeaders(req, res, config.cors);
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
    // In Node.js, we need to listen to the engine's connection event
    if (config.onPollingConnection) {
      const engine = (io as unknown as { engine?: { on?: (event: string, handler: (socket: { id: string; transport?: { name: string }; request?: { socket?: { remoteAddress?: string } }; headers?: { 'x-forwarded-for'?: string } }) => void) => void } }).engine;
      if (engine?.on) {
        engine.on('connection', (socket) => {
          if (socket.transport?.name === 'polling') {
            // Get IP from x-forwarded-for header or socket remote address
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

  getClientIp(context: ConnectionContext): string | undefined {
    // For WebSocket transport, socket.remoteAddress is available
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
