import { describe, expect, test } from 'bun:test';
import { awaitPending } from './awaitPending';
import { abortRun, RunAbortedByUser } from './abortReason';

describe('awaitPending', () => {
  test('resolves with the value given to the stored resolver', async () => {
    const pending = new Map<string, (value: string) => void>();
    const promise = awaitPending(pending, 'id-1', new AbortController().signal);

    pending.get('id-1')!('value-1');

    expect(await promise).toBe('value-1');
  });

  test('rejects at once and stores nothing when the signal is already aborted', async () => {
    const pending = new Map<string, (value: string) => void>();
    const abortController = new AbortController();
    abortRun(abortController, new RunAbortedByUser());

    await expect(awaitPending(pending, 'id-1', abortController.signal)).rejects.toBeInstanceOf(RunAbortedByUser);
    expect(pending.has('id-1')).toBe(false);
  });

  test('deletes the entry and rejects when the signal aborts while pending', async () => {
    const pending = new Map<string, (value: string) => void>();
    const abortController = new AbortController();
    const promise = awaitPending(pending, 'id-1', abortController.signal);

    abortRun(abortController, new RunAbortedByUser());

    await expect(promise).rejects.toBeInstanceOf(RunAbortedByUser);
    expect(pending.has('id-1')).toBe(false);
  });

  test('removes the abort listener when the wait resolves', async () => {
    const pending = new Map<string, (value: string) => void>();
    const signal = new AbortController().signal;
    const added: EventListenerOrEventListenerObject[] = [];
    const removed: EventListenerOrEventListenerObject[] = [];
    const addEventListener = signal.addEventListener.bind(signal);
    const removeEventListener = signal.removeEventListener.bind(signal);
    signal.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions) => {
      added.push(listener);
      addEventListener(type, listener, options);
    }) as AbortSignal['addEventListener'];
    signal.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: EventListenerOptions) => {
      removed.push(listener);
      removeEventListener(type, listener, options);
    }) as AbortSignal['removeEventListener'];

    const promise = awaitPending(pending, 'id-1', signal);
    pending.get('id-1')!('value-1');
    await promise;

    expect(added).toHaveLength(1);
    expect(removed).toEqual(added);
  });

  test('works without a signal', async () => {
    const pending = new Map<string, (value: number) => void>();
    const promise = awaitPending(pending, 'id-1', undefined);

    pending.get('id-1')!(42);

    expect(await promise).toBe(42);
  });
});
