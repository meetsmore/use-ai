import { EventType, type CustomEvent } from '@meetsmore-oss/use-ai-core';
import type { ClientConnection } from './agents/types';
import type { UseAIClientMessage } from './types';
import type { RawWebSocket } from './runtime';
import { logger } from './logger';

/**
 * A plain WebSocket presented as a {@link ClientConnection}.
 *
 * Both directions are JSON text frames. Upstream, each frame is one client message.
 * Downstream, each frame is one AG-UI event: `emit('event', e)` writes `e` as is, and
 * any other name goes out as an AG-UI `CUSTOM` event carrying that name. The client's
 * `WebSocketTransport` reads exactly this.
 */
export class WebSocketClientConnection implements ClientConnection {
  readonly ipAddress: string;

  constructor(readonly id: string, private socket: RawWebSocket) {
    this.ipAddress = socket.remoteAddress || id;
  }

  get connected(): boolean {
    return this.socket.open;
  }

  emit(name: string, data?: unknown): void {
    if (!this.socket.open) return;
    const frame: unknown = name === 'event' ? data : customEvent(name, data);
    this.socket.send(JSON.stringify(frame));
  }

  onMessage(handler: (message: UseAIClientMessage) => void): void {
    this.socket.onMessage((data) => {
      let message: UseAIClientMessage;
      try {
        message = JSON.parse(data) as UseAIClientMessage;
      } catch {
        logger.warn('Discarding malformed frame', { connectionId: this.id });
        return;
      }
      handler(message);
    });
  }

  onClose(handler: () => void): void {
    this.socket.onClose(handler);
  }
}

function customEvent(name: string, value: unknown): CustomEvent {
  return { type: EventType.CUSTOM, name, value, timestamp: Date.now() };
}
