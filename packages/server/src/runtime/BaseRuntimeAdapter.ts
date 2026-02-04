import type { Server as SocketIOServer } from 'socket.io';
import type {
  RuntimeAdapter,
  RuntimeType,
  RuntimeServerConfig,
  RuntimeServerHandle,
  ConnectionContext,
} from './types';

/**
 * Base class for runtime adapters with shared functionality.
 */
export abstract class BaseRuntimeAdapter implements RuntimeAdapter {
  abstract readonly name: RuntimeType;

  abstract createServer(io: SocketIOServer, config: RuntimeServerConfig): RuntimeServerHandle;

  /**
   * Gets the client IP address from a connection context.
   * This implementation works for both Bun and Node.js runtimes.
   */
  getClientIp(context: ConnectionContext): string | undefined {
    // For WebSocket transport, socket.remoteAddress is available directly
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
