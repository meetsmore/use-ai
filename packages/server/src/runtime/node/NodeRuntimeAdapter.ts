import { createServer, type Server as HttpServer } from 'http';
import type { Server as SocketIOServer } from 'socket.io';
import type { RuntimeAdapter, RuntimeServerConfig, RuntimeServerHandle } from '../types';

/**
 * Runtime adapter for Node.js.
 * Uses http.createServer with standard Socket.IO integration.
 *
 * CORS handling is delegated entirely to Socket.IO's built-in CORS support.
 * This avoids redundancy and ensures consistent behavior with credentials.
 */
export class NodeRuntimeAdapter implements RuntimeAdapter {
  readonly name = 'node' as const;

  createServer(io: SocketIOServer, config: RuntimeServerConfig): RuntimeServerHandle {
    // Create Node.js HTTP server
    const httpServer: HttpServer = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${config.port}`);

      // Health check endpoint (no CORS needed - used by K8s probes)
      if (url.pathname === '/health') {
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // Socket.IO handles /socket.io/* paths (including CORS)
      // Other paths return 404
      if (!url.pathname.startsWith('/socket.io/')) {
        res.statusCode = 404;
        res.end('Not Found');
      }
      // Socket.IO will handle the request via its internal listeners
    });

    // Attach Socket.IO to the HTTP server
    // Socket.IO handles CORS internally for /socket.io/* paths
    io.attach(httpServer, {
      transports: ['polling', 'websocket'],
      maxHttpBufferSize: config.maxHttpBufferSize,
      cors: config.cors ? {
        origin: config.cors.origin,
        methods: config.cors.methods ?? ['GET', 'POST'],
        credentials: config.cors.credentials,
      } : undefined,
    });

    // Capture client IP for polling connections
    if (config.onPollingConnection) {
      io.engine.on('connection', (socket) => {
        if (socket.transport.name === 'polling') {
          const xForwardedFor = socket.request.headers['x-forwarded-for'];
          const ip = typeof xForwardedFor === 'string'
            ? xForwardedFor.split(',')[0].trim()
            : socket.request.socket?.remoteAddress;
          if (ip) {
            config.onPollingConnection!(socket.id, ip);
          }
        }
      });
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
