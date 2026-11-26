import { createServer, type IncomingHttpHeaders, type Server as HttpServer } from 'http';
import type { Server as SocketIOServer } from 'socket.io';
import { WebSocketServer } from 'ws';
import type { RuntimeAdapter, RuntimeListener, RuntimeServerConfig, RuntimeServerHandle, WebSocketListener } from '../types';
import { isOriginAllowed, type OriginCheckHeaders } from '../origin';
import { NodeRawWebSocket } from './rawWebSocket';

/**
 * Runtime adapter for Node.js.
 * Serves Socket.IO through its standard http.Server integration, or a plain WebSocket
 * through `ws`, on one HTTP server.
 *
 * For Socket.IO, CORS handling is delegated entirely to Socket.IO's built-in support.
 */
export class NodeRuntimeAdapter implements RuntimeAdapter {
  readonly name = 'node' as const;

  createServer(listener: RuntimeListener, config: RuntimeServerConfig): RuntimeServerHandle {
    const httpServer: HttpServer = createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${config.port}`);

      // Health check endpoint (no CORS needed - used by K8s probes)
      if (url.pathname === '/health') {
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // Socket.IO answers /socket.io/* itself through its own request listener.
      if (listener.transport === 'socketio' && url.pathname.startsWith('/socket.io/')) return;

      res.statusCode = 404;
      res.end('Not Found');
    });

    const wss = listener.transport === 'socketio'
      ? this.attachSocketIO(listener.io, httpServer, config)
      : this.attachWebSocket(listener.onConnection, httpServer, config);

    httpServer.listen(config.port);

    return {
      stop: () => {
        wss?.close();
        httpServer.close();
      },
      server: httpServer,
    };
  }

  private attachSocketIO(io: SocketIOServer, httpServer: HttpServer, config: RuntimeServerConfig): null {
    io.attach(httpServer, {
      transports: ['polling', 'websocket'],
      maxHttpBufferSize: config.maxHttpBufferSize,
      cors: config.cors ? {
        origin: config.cors.origin,
        methods: config.cors.methods ?? ['GET', 'POST'],
        credentials: config.cors.credentials,
      } : undefined,
      // Runs on each handshake, polling or WebSocket. Later requests belong to an accepted session.
      allowRequest: config.allowedOrigins
        ? (req, callback) => callback(null, isOriginAllowed(originCheckHeaders(req.headers), config.allowedOrigins))
        : undefined,
    });

    // Capture client IP for polling connections
    if (config.onPollingConnection) {
      io.engine.on('connection', (socket) => {
        if (socket.transport.name === 'polling') {
          const ip = socket.request.socket?.remoteAddress;
          if (ip) {
            const sessionId = socket.id;
            config.onPollingConnection!(sessionId, ip);
            socket.once('close', () => config.onPollingClose?.(sessionId));
          }
        }
      });
    }
    return null;
  }

  private attachWebSocket(
    onConnection: WebSocketListener['onConnection'],
    httpServer: HttpServer,
    config: RuntimeServerConfig,
  ): WebSocketServer {
    const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxHttpBufferSize });
    httpServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url || '/', `http://localhost:${config.port}`);
      if (url.pathname !== '/') {
        socket.destroy();
        return;
      }
      if (!isOriginAllowed(originCheckHeaders(req.headers), config.allowedOrigins)) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const forwardedFor = req.headers['x-forwarded-for'];
        onConnection(new NodeRawWebSocket(
          ws,
          req.socket.remoteAddress,
          Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor,
        ));
      });
    });
    return wss;
  }
}

/** Reads the origin check headers from a Node request. A repeated header is ignored. */
function originCheckHeaders(headers: IncomingHttpHeaders): OriginCheckHeaders {
  const secFetchSite = headers['sec-fetch-site'];
  return {
    origin: headers.origin,
    secFetchSite: typeof secFetchSite === 'string' ? secFetchSite : undefined,
  };
}
