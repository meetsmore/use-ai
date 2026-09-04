import type { AGUIEvent, UseAIClientMessage } from '../types';

/**
 * The pipe between {@link UseAIClient} and a server.
 *
 * Upstream it carries {@link UseAIClientMessage}. Downstream it delivers AG-UI events.
 * Two payloads that are not AG-UI events, the agent list and the server config, arrive
 * as AG-UI `CUSTOM` events named `agents` and `config`.
 *
 * A transport owns everything protocol-specific: how the connection opens, how it
 * reconnects, and how an event is framed on the wire. Two implementations ship with
 * the library: {@link SocketIOTransport} (the default) and {@link WebSocketTransport}.
 */
export interface UseAITransport {
  /**
   * The server this transport connects to. Reported as `serverUrl` on the provider context.
   * @example 'wss://your-server.com'
   */
  readonly url: string;

  /** Whether the connection is currently open. */
  readonly connected: boolean;

  /** Opens the connection. Reconnection until {@link disconnect} is the transport's own responsibility. */
  connect(): void;

  /** Closes the connection and stops reconnecting. */
  disconnect(): void;

  /** Sends a message upstream. Only called while {@link connected} is true. */
  send(message: UseAIClientMessage): void;

  /**
   * Subscribes to downstream AG-UI events.
   * @returns Cleanup function to unsubscribe
   */
  onEvent(handler: (event: AGUIEvent) => void): () => void;

  /**
   * Subscribes to the connection opening and closing.
   * @param handler - Receives `true` on connect and `false` on disconnect, with the transport's reason
   * @returns Cleanup function to unsubscribe
   */
  onConnectionChange(handler: (connected: boolean, reason?: string) => void): () => void;
}
