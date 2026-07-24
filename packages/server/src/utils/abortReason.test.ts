import { describe, expect, test } from 'bun:test';
import {
  RunAbortedError,
  RunAbortedByUser,
  RunAbortedByClientDisconnect,
  abortRun,
  createAbortError,
  abortReasonMessage,
} from './abortReason';

describe('RunAbortedError concrete types', () => {
  test('class name is the stable identifier (RunAbortedByUser)', () => {
    const err = new RunAbortedByUser();
    expect(err).toBeInstanceOf(RunAbortedError);
    expect(err.name).toBe('RunAbortedByUser');
    expect(err.message).toBe('Run aborted by user');
  });

  test('class name is the stable identifier (RunAbortedByClientDisconnect)', () => {
    const err = new RunAbortedByClientDisconnect();
    expect(err).toBeInstanceOf(RunAbortedError);
    expect(err.name).toBe('RunAbortedByClientDisconnect');
    expect(err.message).toBe('Run aborted by client disconnect');
  });

  test('name is an own property that survives JSON serialization', () => {
    const err = new RunAbortedByUser();
    expect(Object.keys(err)).toContain('name');
    expect(JSON.parse(JSON.stringify(err)).name).toBe('RunAbortedByUser');
  });
});

describe('abortReason helpers', () => {
  test('abortRun tags the signal with the given cause', () => {
    const controller = new AbortController();
    abortRun(controller, new RunAbortedByUser());

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBeInstanceOf(RunAbortedByUser);
    expect((controller.signal.reason as RunAbortedError).name).toBe('RunAbortedByUser');
  });

  test('abortRun keeps the first cause when called twice (native abort no-op)', () => {
    const controller = new AbortController();
    abortRun(controller, new RunAbortedByUser());
    abortRun(controller, new RunAbortedByClientDisconnect());

    expect((controller.signal.reason as RunAbortedError).name).toBe('RunAbortedByUser');
  });

  test('abortRun tolerates a missing controller', () => {
    expect(() => abortRun(undefined, new RunAbortedByUser())).not.toThrow();
  });

  test('createAbortError returns the cause recorded on the signal', () => {
    const controller = new AbortController();
    abortRun(controller, new RunAbortedByClientDisconnect());

    const err = createAbortError(controller.signal);
    expect(err).toBeInstanceOf(RunAbortedByClientDisconnect);
    expect(err).toBe(controller.signal.reason);
    expect(err.name).toBe('RunAbortedByClientDisconnect');
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
    abortRun(userStop, new RunAbortedByUser());
    expect(abortReasonMessage(userStop.signal)).toBe('Run aborted by user');

    const disconnect = new AbortController();
    abortRun(disconnect, new RunAbortedByClientDisconnect());
    expect(abortReasonMessage(disconnect.signal)).toBe('Run aborted by client disconnect');
  });

  test('abortReasonMessage falls back to a generic message without a cause', () => {
    const controller = new AbortController();
    controller.abort();
    expect(abortReasonMessage(controller.signal)).toBe('Run aborted');
    expect(abortReasonMessage(undefined)).toBe('Run aborted');
  });
});
