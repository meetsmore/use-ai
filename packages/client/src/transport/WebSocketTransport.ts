import ReconnectingWebSocket from 'partysocket/ws';
import type { AGUIEvent, UseAIClientMessage } from '../types';
import type { UseAITransport } from './types';

/**
 * Options for {@link WebSocketTransport}.
 */
export interface WebSocketTransportOptions {
  /**
   * Delay before the first reconnection attempt, in milliseconds.
   * Each later attempt doubles the delay, up to {@link reconnectionDelayMax}.
   *
   * @default 1000
   */
  reconnectionDelay?: number;
  /**
   * Upper bound on the delay between reconnection attempts, in milliseconds.
   *
   * @default 10000
   */
  reconnectionDelayMax?: number;
  /**
   * WebSocket constructor to open the connection with.
   * Supply one on a runtime without a global `WebSocket`, or in a test.
   *
   * @default globalThis.WebSocket
   */
  WebSocket?: typeof WebSocket;
}

/**
 * Transport over a plain WebSocket. Every frame is JSON text.
 *
 * Upstream, the client sends each `UseAIClientMessage` as one frame, with nothing
 * around it. Downstream, the server sends one AG-UI event per frame. The client
 * ignores an event type it does not handle.
 *
 * Reconnection is automatic: indefinite, with exponential backoff capped at
 * `reconnectionDelayMax`. The defaults match {@link SocketIOTransport}.
 *
 * @example
 * ```tsx
 * <UseAIProvider transport={new WebSocketTransport('wss://your-server.com')}>
 * ```
 */
export class WebSocketTransport implements UseAITransport {
  private socket: ReconnectingWebSocket | null = null;
  private _connected = false;
  private eventHandlers = new Set<(event: AGUIEvent) => void>();
  private connectionHandlers = new Set<(connected: boolean, reason?: string) => void>();

  /**
   * @param url - WebSocket URL of the server
   * @example
   * ```typescript
   * new WebSocketTransport('wss://your-server.com');
   * ```
   */
  constructor(readonly url: string, private readonly options: WebSocketTransportOptions = {}) {}

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    if (this.socket) return;

    const socket = new ReconnectingWebSocket(this.url, [], {
      WebSocket: this.options.WebSocket,
      minReconnectionDelay: this.options.reconnectionDelay ?? 1000,
      maxReconnectionDelay: this.options.reconnectionDelayMax ?? 10_000,
      reconnectionDelayGrowFactor: 2,
      maxRetries: Infinity,
      // UseAIClient only sends while connected, so nothing is queued for a later socket.
      maxEnqueuedMessages: 0,
    });
    this.socket = socket;

    socket.onopen = () => {
      this._connected = true;
      this.connectionHandlers.forEach(handler => handler(true));
    };

    socket.onmessage = (event) => {
      const frame = parseFrame(event.data);
      if (frame) this.eventHandlers.forEach(handler => handler(frame));
    };

    socket.onerror = (event) => {
      // Use warn instead of error to avoid triggering Next.js error overlay
      console.warn('[UseAI] Connection error:', event.message);
    };

    socket.onclose = () => {
      // A close also fires for a failed attempt. Only a socket that opened reports a disconnection.
      if (!this._connected) return;
      this._connected = false;
      this.connectionHandlers.forEach(handler => handler(false, 'transport close'));
    };
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this._connected = false;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    }
  }

  send(message: UseAIClientMessage): void {
    this.socket?.send(JSON.stringify(message));
  }

  onEvent(handler: (event: AGUIEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  onConnectionChange(handler: (connected: boolean, reason?: string) => void): () => void {
    this.connectionHandlers.add(handler);
    return () => {
      this.connectionHandlers.delete(handler);
    };
  }
}

function parseFrame(data: unknown): AGUIEvent | null {
  if (typeof data !== 'string') {
    console.warn('[UseAI] Ignoring non-text frame');
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    console.warn('[UseAI] Ignoring malformed frame');
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { type?: unknown }).type !== 'string') {
    return null;
  }
  return parsed as AGUIEvent;
}
