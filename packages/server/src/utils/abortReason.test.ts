import { describe, expect, test } from 'bun:test';
import { RunAbortedError, abortRun, createAbortError, abortReasonMessage } from './abortReason';

describe('abortReason', () => {
  test('abortRun tags the signal with a RunAbortedError carrying the cause', () => {
    const controller = new AbortController();
    abortRun(controller, 'user_stop');

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(RunAbortedError);
    expect((controller.signal.reason as RunAbortedError).reason).toBe('user_stop');
    expect((controller.signal.reason as RunAbortedError).message).toBe('Run aborted by user');
  });

  test('abortRun uses a distinct message per cause', () => {
    const controller = new AbortController();
    abortRun(controller, 'client_disconnect');

    expect((controller.signal.reason as RunAbortedError).message).toBe(
      'Run aborted by client disconnect',
    );
  });

  test('abortRun keeps the first cause when called twice (native abort no-op)', () => {
    const controller = new AbortController();
    abortRun(controller, 'user_stop');
    abortRun(controller, 'client_disconnect');

    expect((controller.signal.reason as RunAbortedError).reason).toBe('user_stop');
  });

  test('abortRun tolerates a missing controller', () => {
    expect(() => abortRun(undefined, 'user_stop')).not.toThrow();
  });

  test('createAbortError returns the cause-carrying error from the signal', () => {
    const controller = new AbortController();
    abortRun(controller, 'client_disconnect');

    const err = createAbortError(controller.signal);
    expect(err).toBeInstanceOf(RunAbortedError);
    expect(err).toBe(controller.signal.reason); // the cause recorded on the signal
    expect((err as RunAbortedError).reason).toBe('client_disconnect');
    expect(err.message).toBe('Run aborted by client disconnect');
  });

  test('createAbortError falls back to a generic error without a cause', () => {
    const controller = new AbortController();
    controller.abort(); // aborted without a RunAbortedError reason

    const err = createAbortError(controller.signal);
    expect(err).not.toBeInstanceOf(RunAbortedError);
    expect(err.message).toBe('Run aborted');
  });

  test('createAbortError falls back when the signal is undefined', () => {
    expect(createAbortError(undefined).message).toBe('Run aborted');
  });

  test('abortReasonMessage resolves the cause-specific span message', () => {
    const userStop = new AbortController();
    abortRun(userStop, 'user_stop');
    expect(abortReasonMessage(userStop.signal)).toBe('Run aborted by user');

    const disconnect = new AbortController();
    abortRun(disconnect, 'client_disconnect');
    expect(abortReasonMessage(disconnect.signal)).toBe('Run aborted by client disconnect');
  });

  test('abortReasonMessage falls back to a generic message without a cause', () => {
    const controller = new AbortController();
    controller.abort();
    expect(abortReasonMessage(controller.signal)).toBe('Run aborted');
    expect(abortReasonMessage(undefined)).toBe('Run aborted');
  });
});
