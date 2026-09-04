import ReconnectingWebSocket from 'partysocket/ws';
import { EventType } from '@meetsmore-oss/use-ai-core';
import type { UseAIClientMessage } from '../types';
import { TransportHandlerRegistry } from './handlerRegistry';
import type { UseAITransport, UseAITransportEventName } from './types';

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
 * around it. Downstream, the server sends one AG-UI event per frame. The `agents`
 * and `config` payloads travel as AG-UI `CUSTOM` events named `agents` and `config`.
 * The client ignores an event with a type or a custom name it does not know.
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
  private registry = new TransportHandlerRegistry();
  private _connected = false;
  private readonly options: Required<Pick<WebSocketTransportOptions, 'reconnectionDelay' | 'reconnectionDelayMax'>> &
    Pick<WebSocketTransportOptions, 'WebSocket'>;

  /**
   * @param url - WebSocket URL of the server
   * @example
   * ```typescript
   * new WebSocketTransport('wss://your-server.com');
   * ```
   */
  constructor(readonly url: string, options: WebSocketTransportOptions = {}) {
    this.options = {
      reconnectionDelay: options.reconnectionDelay ?? 1000,
      reconnectionDelayMax: options.reconnectionDelayMax ?? 10_000,
      WebSocket: options.WebSocket,
    };
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    if (this.socket) return;

    const socket = new ReconnectingWebSocket(this.url, [], {
      WebSocket: this.options.WebSocket,
      minReconnectionDelay: this.options.reconnectionDelay,
      maxReconnectionDelay: this.options.reconnectionDelayMax,
      reconnectionDelayGrowFactor: 2,
      maxRetries: Infinity,
      // UseAIClient only sends while connected, so nothing is queued for a later socket.
      maxEnqueuedMessages: 0,
    });
    this.socket = socket;

    socket.onopen = () => {
      this._connected = true;
      this.registry.dispatch('connect', undefined);
    };

    socket.onmessage = (event) => {
      const frame = parseFrame(event.data);
      if (!frame) return;
      if (frame.type === EventType.CUSTOM && (frame.name === 'agents' || frame.name === 'config')) {
        this.registry.dispatch(frame.name, frame.value);
        return;
      }
      this.registry.dispatch('event', frame);
    };

    socket.onerror = (event) => {
      // Use warn instead of error to avoid triggering Next.js error overlay
      console.warn('[UseAI] Connection error:', event.message);
    };

    socket.onclose = () => {
      // A close also fires for a failed attempt. Only a socket that opened reports a disconnection.
      if (!this._connected) return;
      this._connected = false;
      this.registry.dispatch('disconnect', 'transport close');
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

  on(name: UseAITransportEventName, handler: (data: unknown) => void): () => void {
    return this.registry.on(name, handler);
  }
}

interface Frame {
  type: string;
  name?: string;
  value?: unknown;
}

function parseFrame(data: unknown): Frame | null {
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
  const frame = parsed as Partial<Frame>;
  if (typeof frame.type !== 'string') return null;
  return frame as Frame;
}
