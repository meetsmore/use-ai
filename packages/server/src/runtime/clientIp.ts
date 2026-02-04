/**
 * Client IP tracking for Socket.IO connections.
 *
 * WebSocket connections can get the remote address directly from the socket.
 * Polling connections need to track the IP at connection time because the
 * transport socket may not be available later.
 */

/**
 * Interface for connection context used to retrieve client IP.
 */
export interface ClientIpConnection {
  id: string;
  transport: {
    socket?: {
      remoteAddress?: string;
    };
  };
}

/**
 * Client IP tracker for managing IP addresses across transport types.
 */
export interface ClientIpTracker {
  /**
   * Store IP address for a polling connection.
   * Called when a polling transport connection is established.
   */
  trackPollingConnection(sessionId: string, ip: string): void;

  /**
   * Remove stored IP address when a connection disconnects.
   */
  removePollingConnection(sessionId: string): void;

  /**
   * Get the client IP address for a connection.
   * For WebSocket: uses socket.remoteAddress directly.
   * For polling: uses the stored IP from trackPollingConnection.
   */
  getClientIp(conn: ClientIpConnection): string | undefined;
}

/**
 * Creates a ClientIpTracker instance.
 *
 * @returns A new ClientIpTracker
 */
export function createClientIpTracker(): ClientIpTracker {
  const pollingClientIps = new Map<string, string>();

  return {
    trackPollingConnection(sessionId: string, ip: string): void {
      pollingClientIps.set(sessionId, ip);
    },

    removePollingConnection(sessionId: string): void {
      pollingClientIps.delete(sessionId);
    },

    getClientIp(conn: ClientIpConnection): string | undefined {
      // For WebSocket transport, socket.remoteAddress is available directly
      if (conn.transport.socket?.remoteAddress) {
        return conn.transport.socket.remoteAddress;
      }
      // For polling transport, use the stored IP from pollingClientIps map
      return pollingClientIps.get(conn.id);
    },
  };
}
