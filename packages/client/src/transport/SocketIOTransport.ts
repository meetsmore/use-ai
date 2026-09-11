import { io, Socket } from 'socket.io-client';
import { EventType, type CustomEvent } from '@meetsmore-oss/use-ai-core';
import type { AGUIEvent, UseAIClientMessage } from '../types';
import type { UseAITransport } from './types';

// Reconnect indefinitely so clients recover after extended outages (mobile
// app backgrounded long enough for server pingTimeout, airplane mode, etc.).
// Socket.IO applies exponential backoff capped at RECONNECTION_DELAY_MAX,
// so steady-state retry frequency is ~one attempt per 10s.
const RECONNECTION_DELAY = 1000;
const RECONNECTION_DELAY_MAX = 10_000;

/**
 * Transport over Socket.IO. This is what {@link UseAIProvider} uses when given a `serverUrl`,
 * and what the bundled `@meetsmore-oss/use-ai-server` serves by default.
 *
 * @example
 * ```typescript
 * const transport = new SocketIOTransport('wss://your-server.com');
 * ```
 */
export class SocketIOTransport implements UseAITransport {
  private socket: Socket | null = null;
  private eventHandlers = new Set<(event: AGUIEvent) => void>();
  private connectionHandlers = new Set<(connected: boolean, reason?: string) => void>();

  /**
   * @param url - The URL of the UseAI server
   * @example
   * ```typescript
   * new SocketIOTransport('ws://localhost:8081');
   * ```
   */
  constructor(readonly url: string) {}

  get connected(): boolean {
    return this.socket !== null && this.socket.connected;
  }

  connect(): void {
    const socket = io(this.url, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: RECONNECTION_DELAY,
      reconnectionDelayMax: RECONNECTION_DELAY_MAX,
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

      this.connectionHandlers.forEach(handler => handler(true));
    });

    socket.on('event', (event: AGUIEvent) => this.dispatch(event));
    // The Socket.IO server sends these two on their own channels; every other
    // transport carries them as AG-UI CUSTOM events, so present them the same way.
    socket.on('agents', (value: unknown) => this.dispatch(customEvent('agents', value)));
    socket.on('config', (value: unknown) => this.dispatch(customEvent('config', value)));

    socket.on('connect_error', (error: Error) => {
      // Use warn instead of error to avoid triggering Next.js error overlay
      console.warn('[UseAI] Connection error:', error.message);
    });

    socket.on('disconnect', (reason: string) => {
      this.connectionHandlers.forEach(handler => handler(false, reason));
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  send(message: UseAIClientMessage): void {
    this.socket?.emit('message', message);
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

  private dispatch(event: AGUIEvent): void {
    this.eventHandlers.forEach(handler => handler(event));
  }
}

function customEvent(name: string, value: unknown): CustomEvent {
  return { type: EventType.CUSTOM, name, value, timestamp: Date.now() };
}
