import type { ClientConnection } from './agents/types';
import type { RawWebSocket } from './runtime';

/**
 * A plain WebSocket presented as a {@link ClientConnection}.
 *
 * Named payloads go out as `{"name":...,"data":...}` text frames, which is the
 * downstream framing `WebSocketTransport` reads. Upstream frames are the client
 * message serialized on its own.
 */
export class WebSocketClientConnection implements ClientConnection {
  constructor(readonly id: string, private socket: RawWebSocket) {}

  get connected(): boolean {
    return this.socket.open;
  }

  emit(name: string, data?: unknown): void {
    if (!this.socket.open) return;
    this.socket.send(JSON.stringify({ name, data }));
  }
}
