import { createAbortError } from './abortReason';

/**
 * Waits for a value that another handler delivers through a pending map.
 *
 * The function stores a resolver under `id` in `pending`. The handler that gets
 * the value calls the resolver and deletes the entry.
 *
 * If `signal` is already aborted, the promise rejects at once and stores nothing.
 * If `signal` aborts while the wait is pending, the function deletes the entry and
 * rejects with `createAbortError(signal)`. The resolver removes the abort listener,
 * so a settled wait does not keep a listener on the signal.
 *
 * @param pending - The map that holds the resolver until the value arrives
 * @param id - The key for the resolver in `pending`
 * @param signal - The abort signal of the current run, if there is one
 * @returns Promise that resolves with the delivered value
 */
export function awaitPending<T>(
  pending: Map<string, (value: T) => void>,
  id: string,
  signal: AbortSignal | undefined
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // Check if already aborted (for example, the client disconnected first)
    if (signal?.aborted) {
      reject(createAbortError(signal));
      return;
    }

    const onAbort = () => {
      pending.delete(id);
      reject(createAbortError(signal));
    };

    pending.set(id, (value) => {
      signal?.removeEventListener('abort', onAbort);
      resolve(value);
    });

    // Listen for abort signal to reject the promise (client disconnect or explicit abort)
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
