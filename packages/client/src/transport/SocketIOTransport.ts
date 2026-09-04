import { io, Socket } from 'socket.io-client';
import type { UseAIClientMessage } from '../types';
import { TransportHandlerRegistry } from './handlerRegistry';
import type { UseAITransport, UseAITransportEventName } from './types';

/**
 * Options for {@link SocketIOTransport}.
 */
export interface SocketIOTransportOptions {
  /**
   * Delay before the first reconnection attempt, in milliseconds.
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
}

/**
 * Transport over Socket.IO. This is what {@link UseAIProvider} uses when given only a `serverUrl`,
 * and what the bundled `@meetsmore-oss/use-ai-server` serves.
 *
 * @example
 * ```typescript
 * const transport = new SocketIOTransport('wss://your-server.com');
 * ```
 */
export class SocketIOTransport implements UseAITransport {
  private socket: Socket | null = null;
  private registry = new TransportHandlerRegistry();
  // Reconnect indefinitely so clients recover after extended outages (mobile
  // app backgrounded long enough for server pingTimeout, airplane mode, etc.).
  // Socket.IO applies exponential backoff capped at reconnectionDelayMax,
  // so steady-state retry frequency is ~one attempt per 10s.
  private reconnectionDelay: number;
  private reconnectionDelayMax: number;

  /**
   * @param url - The URL of the UseAI server
   * @example
   * ```typescript
   * new SocketIOTransport('ws://localhost:8081');
   * ```
   */
  constructor(readonly url: string, options: SocketIOTransportOptions = {}) {
    this.reconnectionDelay = options.reconnectionDelay ?? 1000;
    this.reconnectionDelayMax = options.reconnectionDelayMax ?? 10_000;
  }

  get connected(): boolean {
    return this.socket !== null && this.socket.connected;
  }

  connect(): void {
    const socket = io(this.url, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: this.reconnectionDelay,
      reconnectionDelayMax: this.reconnectionDelayMax,
      withCredentials: true,
    });
    this.socket = socket;

    socket.on('connect', () => {
      console.log('[UseAI] Transport:', socket.io?.engine?.transport?.name);

      const engine = socket.io?.engine;
      if (engine) {
        engine.on('upgrade', (transport: { name: string }) => {
          console.log('[UseAI] Upgraded to transport:', transport.name);
        });

        engine.on('upgradeError', (err: { message: string }) => {
          console.warn('[UseAI] Upgrade error:', err.message);
        });
      }

      this.registry.dispatch('connect', undefined);
    });

    socket.on('event', (event: unknown) => this.registry.dispatch('event', event));
    socket.on('agents', (data: unknown) => this.registry.dispatch('agents', data));
    socket.on('config', (data: unknown) => this.registry.dispatch('config', data));

    socket.on('connect_error', (error: Error) => {
      // Use warn instead of error to avoid triggering Next.js error overlay
      console.warn('[UseAI] Connection error:', error.message);
    });

    socket.on('disconnect', (reason: string) => {
      this.registry.dispatch('disconnect', reason);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  send(message: UseAIClientMessage): void {
    this.socket?.emit('message', message);
  }

  on(name: UseAITransportEventName, handler: (data: unknown) => void): () => void {
    return this.registry.on(name, handler);
  }
}
