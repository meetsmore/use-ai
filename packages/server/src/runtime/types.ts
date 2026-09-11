import type { Server as SocketIOServer } from 'socket.io';
import type { CorsOptions } from '../types';

/**
 * Runtime type identifier.
 */
export type RuntimeType = 'bun' | 'node';

/**
 * A plain WebSocket connection, as the runtime adapters expose it.
 * Text frames only; the framing above it is the caller's business.
 */
export interface RawWebSocket {
  /** Remote address of the peer, when the runtime exposes one. */
  readonly remoteAddress?: string;
  /** Whether the connection is still open. */
  readonly open: boolean;
  /** Sends a text frame. */
  send(data: string): void;
  /** Closes the connection. */
  close(): void;
  /** Registers the handler for text frames arriving from the peer. */
  onMessage(handler: (data: string) => void): void;
  /** Registers the handler for the connection closing, for any reason. */
  onClose(handler: () => void): void;
}

/** Hands the HTTP server's `/socket.io/` traffic to a Socket.IO server. */
export interface SocketIOListener {
  transport: 'socketio';
  io: SocketIOServer;
}

/** Accepts plain WebSocket upgrades at `/`. */
export interface WebSocketListener {
  transport: 'websocket';
  onConnection(connection: RawWebSocket): void;
}

/** What the HTTP server hands connections to. A server runs exactly one. */
export type RuntimeListener = SocketIOListener | WebSocketListener;

/**
 * Configuration for creating a runtime server.
 */
export interface RuntimeServerConfig {
  /** Port number to listen on */
  port: number;
  /** CORS configuration options */
  cors?: CorsOptions;
  /**
   * Idle timeout in seconds.
   * Only used by Bun runtime (ignored by Node.js).
   * @default 30
   */
  idleTimeout?: number;
  /** Maximum HTTP buffer size in bytes for Socket.IO payloads */
  maxHttpBufferSize?: number;
  /**
   * Callback for capturing client IP addresses during polling connections.
   * Called when a polling transport connection is established.
   */
  onPollingConnection?: (sessionId: string, ip: string) => void;
}

/**
 * Handle to a running server instance.
 */
export interface RuntimeServerHandle {
  /** Stop the server */
  stop(): void;
  /** The underlying server instance (type varies by runtime) */
  server: unknown;
}

/**
 * Adapter interface for runtime-specific server implementations.
 * Abstracts the differences between Bun and Node.js runtimes.
 */
export interface RuntimeAdapter {
  /** The runtime type identifier */
  readonly name: RuntimeType;

  /**
   * Creates an HTTP server and binds the listener to it.
   *
   * @param listener - Socket.IO server, or a plain WebSocket connection handler
   * @param config - Server configuration
   * @returns Handle to the running server
   */
  createServer(listener: RuntimeListener, config: RuntimeServerConfig): RuntimeServerHandle;
}
