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
 * Context for getting client IP address.
 */
export interface ConnectionContext {
  /** Engine.io connection object */
  conn: {
    id: string;
    transport: {
      name: string;
      socket?: {
        remoteAddress?: string;
      };
    };
  };
  /** Map of polling client IPs (keyed by session ID) */
  pollingClientIps?: Map<string, string>;
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

  /**
   * Gets the client IP address from a connection context.
   *
   * @param context - Connection context with transport information
   * @returns The client IP address, or undefined if not available
   */
  getClientIp(context: ConnectionContext): string | undefined;
}
