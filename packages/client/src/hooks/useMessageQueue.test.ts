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

  test('clears a message queued behind a failing send instead of delivering it to a later caller', async () => {
    let rejectA: (error: Error) => void = () => {};
    const sendFn = mock((message: string) => {
      if (message === 'A') {
        return new Promise<void>((_resolve, reject) => {
          rejectA = reject;
        });
      }
      return Promise.resolve();
    });

    const { result } = renderHook(() => useMessageQueue(createOptions(sendFn)));

    let sendAPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      sendAPromise = result.current.sendMessage('A');
      // Let the queue processor reach the in-flight sendFn('A') call.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      // Queued behind the in-flight 'A' drain; today this is unreachable until 'A' settles.
      await result.current.sendMessage('B');
    });

    await act(async () => {
      rejectA(new Error('upload failed'));
      await expect(sendAPromise).rejects.toThrow('upload failed');
    });

    await act(async () => {
      await result.current.sendMessage('C');
    });

    const sentMessages = sendFn.mock.calls.map((call) => call[0]);
    expect(sentMessages).not.toContain('B');
    expect(sentMessages).toEqual(['A', 'C']);
  });
});
