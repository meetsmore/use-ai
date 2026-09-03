import type { UseAIClientMessage } from '../types';

/**
 * Names of the downstream channels a transport delivers to {@link UseAIClient}.
 *
 * - `connect` / `disconnect` — connection lifecycle. `disconnect` carries a reason string.
 * - `event` — an AG-UI event.
 * - `agents` — the server's agent list, `{ agents, defaultAgent }`.
 * - `config` — server capability flags, `{ langfuseEnabled }`.
 */
export type UseAITransportEventName = 'connect' | 'disconnect' | 'event' | 'agents' | 'config';

/**
 * The pipe between {@link UseAIClient} and a server.
 *
 * A transport carries {@link UseAIClientMessage} upstream and named payloads downstream.
 * It owns everything protocol-specific: how a connection is opened, how it reconnects,
 * and how a named payload is framed on the wire.
 *
 * Two implementations ship with the library: {@link SocketIOTransport} (the default)
 * and {@link WebSocketTransport}.
 */
export interface UseAITransport {
  /** Opens the connection. Reconnection until {@link disconnect} is the transport's own responsibility. */
  connect(): void;

  /** Closes the connection and stops reconnecting. */
  disconnect(): void;

  /** Sends a message upstream. Only called while {@link connected} is true. */
  send(message: UseAIClientMessage): void;

  /**
   * Subscribes to a downstream channel.
   *
   * @returns Cleanup function to unsubscribe
   */
  on(name: UseAITransportEventName, handler: (data: unknown) => void): () => void;

  /** Whether the connection is currently open. */
  readonly connected: boolean;
}
