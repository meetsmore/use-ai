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

  function queueBehindFailingSend() {
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
    return { sendFn, result, rejectA: (error: Error) => rejectA(error) };
  }

  test('resolves a queued caller only once its message has been sent', async () => {
    const { result } = queueBehindFailingSend();

    let bSettled = false;
    await act(async () => {
      result.current.sendMessage('A').catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 0));
      result.current.sendMessage('B').then(() => { bSettled = true; }, () => { bSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(bSettled).toBe(false);
  });

  test('delivers a message queued behind a failing send', async () => {
    const { sendFn, result, rejectA } = queueBehindFailingSend();

    let sendAPromise: Promise<void> = Promise.resolve();
    let sendBPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      sendAPromise = result.current.sendMessage('A');
      await new Promise((resolve) => setTimeout(resolve, 0));
      sendBPromise = result.current.sendMessage('B');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      rejectA(new Error('upload failed'));
      await expect(sendAPromise).rejects.toThrow('upload failed');
      await sendBPromise;
    });

    expect(sendFn.mock.calls.map((call) => call[0])).toEqual(['A', 'B']);
  });
});
