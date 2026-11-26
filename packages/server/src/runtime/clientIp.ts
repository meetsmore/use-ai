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
   * Remove stored IP address when the engine.io session closes.
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
 * The client address of a connection, from the peer address and the `X-Forwarded-For` header
 * of its first request.
 *
 * `trustedProxyCount` is the number of proxies in front of the server that append the address
 * they saw to `X-Forwarded-For` (an AWS ALB in its default `append` mode is one). The entries are
 * read from the right, because a client can write any value at the left. With N trusted proxies,
 * the Nth entry from the right is the client. When the header has fewer entries, the leftmost
 * one is used. With 0, the header is ignored and the peer address is the client.
 *
 * Setting a count higher than the proxies really in front lets a client choose its address.
 */
export function resolveClientIp(
  peerAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustedProxyCount: number,
): string | undefined {
  if (trustedProxyCount <= 0 || forwardedFor === undefined) return peerAddress;
  // Node joins repeated headers with ', ' for x-forwarded-for, but the type allows an array.
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  const entries = header.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0);
  if (entries.length === 0) return peerAddress;
  return entries[Math.max(entries.length - trustedProxyCount, 0)];
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
