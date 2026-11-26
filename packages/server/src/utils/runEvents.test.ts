import { describe, expect, test } from 'bun:test';
import { EventType } from '../types';
import { runError, runStarted } from './runEvents';

describe('runEvents', () => {
  test('runError builds a RUN_ERROR event', () => {
    const event = runError('ABORTED');
    expect(event).toEqual({ type: EventType.RUN_ERROR, message: 'ABORTED', timestamp: expect.any(Number) });
  });

  test('runStarted builds a RUN_STARTED event without input', () => {
    const event = runStarted('thread-1', 'run-1');
    expect(event).toEqual({ type: EventType.RUN_STARTED, threadId: 'thread-1', runId: 'run-1', timestamp: expect.any(Number) });
    expect('input' in event).toBe(false);
  });
});
