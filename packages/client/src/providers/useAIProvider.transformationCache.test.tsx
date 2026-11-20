import React from 'react';
import { describe, test, expect, mock, spyOn } from 'bun:test';
import { render } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import type { FileTransformer } from '../fileUpload/types';

function createMockSocket() {
  const socket: Partial<Socket> & { connected: boolean } = {
    on: mock(() => socket as Socket),
    emit: mock(() => socket as Socket),
    connected: false,
    disconnect: mock(() => socket as Socket),
    io: { engine: { transport: { name: 'websocket' }, on: mock() } } as unknown as Socket['io'],
  };
  return socket as Socket;
}

mock.module('socket.io-client', () => ({
  io: () => createMockSocket(),
}));

const { UseAIProvider } = await import('./useAIProvider');
const { getTransformedContent, clearTransformationCache } = await import('../fileUpload/processAttachments');

describe('UseAIProvider transformation cache', () => {
  test('clears the file transformation cache when the provider unmounts', async () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    clearTransformationCache();

    let callCount = 0;
    const transformer: FileTransformer = {
      transform: async (files) => {
        callCount++;
        return files.map((f) => `OCR: ${f.name}`);
      },
    };
    const file = new File(['content'], 'scan.pdf', { type: 'application/pdf', lastModified: 0 });

    const { unmount } = render(
      <UseAIProvider serverUrl="http://localhost:8081" renderChat={false}>
        <div />
      </UseAIProvider>
    );

    await getTransformedContent([file], transformer, { chat: null });
    await getTransformedContent([file], transformer, { chat: null });
    expect(callCount).toBe(1);

    unmount();

    await getTransformedContent([file], transformer, { chat: null });
    expect(callCount).toBe(2);
    logSpy.mockRestore();
  });
});
