import { describe, test, expect, mock } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useMessageQueue } from './useMessageQueue';

function createOptions(sendFn: (message: string) => Promise<void>) {
  return {
    sendFn,
    createNewChat: mock(async () => 'chat-id'),
    connected: true,
    loading: false,
    hasPendingApproval: false,
  };
}

describe('useMessageQueue', () => {
  test('processes a later message after an earlier send rejects', async () => {
    const sendFn = mock((message: string) => {
      if (message === 'fails') {
        return Promise.reject(new Error('upload failed'));
      }
      return Promise.resolve();
    });

    const { result } = renderHook(() => useMessageQueue(createOptions(sendFn)));

    await act(async () => {
      await expect(result.current.sendMessage('fails')).rejects.toThrow('upload failed');
    });

    await act(async () => {
      await result.current.sendMessage('second');
    });

    expect(sendFn).toHaveBeenCalledTimes(2);
    expect(sendFn).toHaveBeenNthCalledWith(1, 'fails', undefined, undefined);
    expect(sendFn).toHaveBeenNthCalledWith(2, 'second', undefined, undefined);
  });
});
