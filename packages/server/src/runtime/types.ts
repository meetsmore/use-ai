import type { Server as SocketIOServer } from 'socket.io';
import type { CorsOptions } from '../types';

/**
 * Runtime type identifier.
 */
export type RuntimeType = 'bun' | 'node';

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
   * Creates an HTTP server and binds Socket.IO to it.
   *
   * @param io - Socket.IO server instance
   * @param config - Server configuration
   * @returns Handle to the running server
   */
  createServer(io: SocketIOServer, config: RuntimeServerConfig): RuntimeServerHandle;
}
