import type { Socket } from 'socket.io';
import type { ClientConnection } from './agents/types';
import type { UseAIClientMessage } from './types';
import type { ClientIpConnection, ClientIpTracker } from './runtime';
import { logger } from './logger';

/**
 * A Socket.IO socket presented as a {@link ClientConnection}.
 */
export class SocketIOClientConnection implements ClientConnection {
  readonly id: string;
  readonly ipAddress: string;

  constructor(private socket: Socket, ipTracker: ClientIpTracker) {
    this.id = socket.id;
    const conn = socket.conn as unknown as ClientIpConnection;
    // Polling connections record their address at engine level, since the transport
    // socket is not available later; WebSocket connections carry it on the handshake.
    this.ipAddress = ipTracker.getClientIp(conn) || socket.handshake.address || socket.id;

    logger.info('Socket.IO connection', { connectionId: this.id, transport: socket.conn.transport.name });
    socket.conn.on('upgrade', (transport) => {
      logger.info('Socket.IO connection upgraded transport', { connectionId: this.id, transport: transport.name });
    });
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  emit(name: string, data?: unknown): void {
    if (this.socket.connected) this.socket.emit(name, data);
  }

  onMessage(handler: (message: UseAIClientMessage) => void): void {
    this.socket.on('message', handler);
  }

  onClose(handler: () => void): void {
    // The runtime adapter removes the polling IP record when the engine.io session closes.
    this.socket.on('disconnect', handler);
  }
}
