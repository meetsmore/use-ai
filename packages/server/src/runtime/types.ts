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

/**
 * A plain WebSocket listener, served on the same port and HTTP server as Socket.IO.
 */
export interface RawWebSocketListener {
  /**
   * Path that upgrades to a plain WebSocket.
   * @example '/ws'
   */
  path: string;
  /** Called once per accepted connection. */
  onConnection(connection: RawWebSocket): void;
}

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
  /**
   * Plain WebSocket listener to serve alongside Socket.IO.
   * Omit to serve Socket.IO only.
   */
  websocket?: RawWebSocketListener;
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
   * Creates an HTTP server and binds Socket.IO to it.
   *
   * @param io - Socket.IO server instance
   * @param config - Server configuration
   * @returns Handle to the running server
   */
  createServer(io: SocketIOServer, config: RuntimeServerConfig): RuntimeServerHandle;
}
