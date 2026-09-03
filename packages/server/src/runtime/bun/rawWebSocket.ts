import type { RawWebSocket } from '../types';

/** Marks a Bun WebSocket as belonging to the plain listener rather than to Socket.IO. */
export interface RawWebSocketData {
  useAiRawWebSocket: true;
  remoteAddress?: string;
}

interface BunWebSocket {
  readonly readyState: number;
  data: unknown;
  send(data: string): unknown;
  close(): void;
}

const OPEN = 1;

/**
 * Adapts a Bun WebSocket, which delivers frames through the server-level handler
 * table rather than per-socket callbacks, to {@link RawWebSocket}.
 */
export class BunRawWebSocket implements RawWebSocket {
  private messageHandler: ((data: string) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  constructor(private ws: BunWebSocket, readonly remoteAddress?: string) {}

  get open(): boolean {
    return this.ws.readyState === OPEN;
  }

  send(data: string): void {
    this.ws.send(data);
  }

  close(): void {
    this.ws.close();
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  receiveMessage(data: string): void {
    this.messageHandler?.(data);
  }

  receiveClose(): void {
    this.closeHandler?.();
  }
}

export function isRawWebSocket(ws: { data?: unknown }): boolean {
  return (ws.data as Partial<RawWebSocketData> | undefined)?.useAiRawWebSocket === true;
}
