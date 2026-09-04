import { mock } from 'bun:test';
import type { Socket } from 'socket.io-client';

export type MockSocket = Partial<Socket> & { connected: boolean };

export interface SocketIOMock {
  /** The socket the most recent `io()` call returned. */
  readonly socket: MockSocket;
  /** The options the most recent `io()` call received. */
  readonly ioOptions: Record<string, unknown> | undefined;
  /** Fires a socket event, or an engine event as `engine:<name>`. */
  fire(event: string, ...args: unknown[]): void;
}

/**
 * Replaces `socket.io-client` so `io()` returns a scriptable socket.
 * Call at the top of the test file, before importing anything that imports the transport.
 */
export function installSocketIOMock(): SocketIOMock {
  let handlers: Record<string, Function[]> = {};
  let socket: MockSocket;
  let ioOptions: Record<string, unknown> | undefined;

  mock.module('socket.io-client', () => ({
    io: (_url: string, options: Record<string, unknown>) => {
      ioOptions = options;
      handlers = {};
      socket = {
        on: mock((event: string, handler: Function) => {
          (handlers[event] ??= []).push(handler);
          return socket as Socket;
        }),
        emit: mock(() => socket as Socket),
        connected: false,
        disconnect: mock(() => socket as Socket),
        io: {
          engine: {
            transport: { name: 'polling' },
            on: mock((event: string, handler: Function) => {
              (handlers[`engine:${event}`] ??= []).push(handler);
            }),
          },
        } as never,
      };
      return socket;
    },
  }));

  return {
    get socket() {
      return socket;
    },
    get ioOptions() {
      return ioOptions;
    },
    fire(event, ...args) {
      handlers[event]?.forEach(handler => handler(...args));
    },
  };
}
