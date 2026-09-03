import type { UseAIClientMessage } from '../types';
import { TransportHandlerRegistry } from './handlerRegistry';
import type { UseAITransport, UseAITransportEventName } from './types';

/**
 * The subset of the WHATWG `WebSocket` API that {@link WebSocketTransport} uses.
 * Declared structurally so a test double, or a polyfill on a runtime without a
 * global `WebSocket`, can stand in for the real thing.
 */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/**
 * A downstream frame, as sent by the server.
 *
 * @example
 * ```json
 * { "name": "config", "data": { "langfuseEnabled": true } }
 * ```
 */
interface DownstreamFrame {
  name: string;
  data: unknown;
}

/**
 * Options for {@link WebSocketTransport}.
 */
export interface WebSocketTransportOptions {
  /**
   * Delay before the first reconnection attempt, in milliseconds.
   * Subsequent attempts double this, up to {@link reconnectionDelayMax}.
   *
   * @default 1000
   */
  reconnectionDelay?: number;
  /**
   * Upper bound on the exponential backoff between reconnection attempts, in milliseconds.
   *
   * @default 10000
   */
  reconnectionDelayMax?: number;
  /**
   * Opens the underlying socket.
   *
   * @default (url) => new WebSocket(url)
   */
  createWebSocket?: (url: string) => WebSocketLike;
}

/**
 * Transport over a plain WebSocket carrying JSON text frames.
 *
 * Use this to reach a server that does not speak Socket.IO. The framing is:
 *
 * - **Upstream** — the `UseAIClientMessage`, serialized, with nothing wrapped around it:
 *   `{"type":"run_agent","data":{...}}`
 * - **Downstream** — a named envelope, because a plain WebSocket has no event names of its own:
 *   `{"name":"event","data":{...}}`. The names are `event`, `agents` and `config`.
 *   A frame with any other name is ignored, so a server may add names without breaking
 *   older clients.
 *
 * A server should send `agents` and `config` once, after the connection opens.
 *
 * @example
 * ```typescript
 * <UseAIProvider
 *   serverUrl="wss://your-server.com"
 *   transport={new WebSocketTransport('wss://your-server.com/ws')}
 * >
 * ```
 */
export class WebSocketTransport implements UseAITransport {
  private socket: WebSocketLike | null = null;
  private registry = new TransportHandlerRegistry();
  private _connected = false;
  // A plain WebSocket has no reconnection of its own, so this transport matches
  // the Socket.IO settings: retry indefinitely with exponential backoff capped at
  // reconnectionDelayMax, so a client recovers after an extended outage (mobile app
  // backgrounded, airplane mode) without hammering the server in the meantime.
  private reconnectionDelay: number;
  private reconnectionDelayMax: number;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnecting = false;
  private createWebSocket: (url: string) => WebSocketLike;

  /**
   * @param url - WebSocket URL of the server
   * @example
   * ```typescript
   * new WebSocketTransport('wss://your-server.com/ws');
   * ```
   */
  constructor(private url: string, options: WebSocketTransportOptions = {}) {
    this.reconnectionDelay = options.reconnectionDelay ?? 1000;
    this.reconnectionDelayMax = options.reconnectionDelayMax ?? 10_000;
    this.createWebSocket =
      options.createWebSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    this.reconnecting = true;
    this.open();
  }

  disconnect(): void {
    this.reconnecting = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const socket = this.socket;
    this.socket = null;
    this._connected = false;
    if (socket) {
      this.detach(socket);
      socket.close();
    }
  }

  send(message: UseAIClientMessage): void {
    this.socket?.send(JSON.stringify(message));
  }

  on(name: UseAITransportEventName, handler: (data: unknown) => void): () => void {
    return this.registry.on(name, handler);
  }

  private open(): void {
    let socket: WebSocketLike;
    try {
      socket = this.createWebSocket(this.url);
    } catch (error) {
      // Use warn instead of error to avoid triggering Next.js error overlay
      console.warn('[UseAI] Connection error:', error instanceof Error ? error.message : error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this._connected = true;
      this.reconnectAttempts = 0;
      this.registry.dispatch('connect', undefined);
    };

    socket.onmessage = (event) => {
      const frame = this.parseFrame(event.data);
      if (!frame) return;
      this.registry.dispatch(frame.name, frame.data);
    };

    socket.onerror = () => {
      // onclose always follows, and that is where reconnection is scheduled.
      console.warn('[UseAI] Connection error:', this.url);
    };

    socket.onclose = () => {
      this.detach(socket);
      if (this.socket !== socket) return;
      this.socket = null;

      const wasConnected = this._connected;
      this._connected = false;
      // A socket that never opened reports only a failed attempt, not a disconnection.
      if (wasConnected) {
        this.registry.dispatch('disconnect', 'transport close');
      }
      this.scheduleReconnect();
    };
  }

  private parseFrame(data: unknown): DownstreamFrame | null {
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
    if (typeof parsed !== 'object' || parsed === null) return null;
    const frame = parsed as Partial<DownstreamFrame>;
    if (typeof frame.name !== 'string') return null;
    return { name: frame.name, data: frame.data };
  }

  private detach(socket: WebSocketLike): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
  }

  private scheduleReconnect(): void {
    if (!this.reconnecting || this.reconnectTimer !== null) return;

    const delay = Math.min(
      this.reconnectionDelay * 2 ** this.reconnectAttempts,
      this.reconnectionDelayMax,
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.reconnecting) this.open();
    }, delay);
  }
}
