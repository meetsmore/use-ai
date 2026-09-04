import { EventType } from '@meetsmore-oss/use-ai-core';
import type { ClientConnection } from './agents/types';
import type { RawWebSocket } from './runtime';

/**
 * A plain WebSocket presented as a {@link ClientConnection}.
 *
 * The downstream stream is AG-UI: `emit('event', e)` writes the event as one JSON text
 * frame, and any other name goes out as an AG-UI `CUSTOM` event carrying that name.
 * `WebSocketTransport` on the client reads exactly this.
 */
export class WebSocketClientConnection implements ClientConnection {
  constructor(readonly id: string, private socket: RawWebSocket) {}

  get connected(): boolean {
    return this.socket.open;
  }

  emit(name: string, data?: unknown): void {
    if (!this.socket.open) return;
    const frame = name === 'event'
      ? data
      : { type: EventType.CUSTOM, name, value: data, timestamp: Date.now() };
    this.socket.send(JSON.stringify(frame));
  }
}
