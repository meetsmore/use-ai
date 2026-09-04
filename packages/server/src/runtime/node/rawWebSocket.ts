import type { WebSocket } from 'ws';
import type { RawWebSocket } from '../types';

/**
 * Adapts a `ws` WebSocket to {@link RawWebSocket}.
 */
export class NodeRawWebSocket implements RawWebSocket {
  constructor(private ws: WebSocket, readonly remoteAddress?: string) {}

  get open(): boolean {
    return this.ws.readyState === this.ws.OPEN;
  }

  send(data: string): void {
    this.ws.send(data);
  }

  close(): void {
    this.ws.close();
  }

  onMessage(handler: (data: string) => void): void {
    this.ws.on('message', (data: unknown, isBinary: boolean) => {
      if (!isBinary) handler(String(data));
    });
  }

  onClose(handler: () => void): void {
    this.ws.on('close', handler);
  }
}
