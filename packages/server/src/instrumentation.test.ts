/**
 * Unit tests for instrumentation.ts trace ID storage functions.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { pushTraceIdForRun, popTraceIdForRun } from './instrumentation';

describe('Trace ID Storage', () => {
  // Use unique runIds per test to avoid cross-test pollution
  const uniqueId = () => `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  describe('pushTraceIdForRun', () => {
    test('stores trace ID for a runId', () => {
      const runId = uniqueId();
      const traceId = 'abc123def456';

      pushTraceIdForRun(runId, traceId);

      expect(popTraceIdForRun(runId)).toBe(traceId);
    });

    test('overwrites existing trace ID for same runId', () => {
      const runId = uniqueId();
      const traceId1 = 'first-trace';
      const traceId2 = 'second-trace';

      pushTraceIdForRun(runId, traceId1);
      pushTraceIdForRun(runId, traceId2);

      expect(popTraceIdForRun(runId)).toBe(traceId2);
    });
  });

  describe('popTraceIdForRun', () => {
    test('returns trace ID and removes it from storage', () => {
      const runId = uniqueId();
      const traceId = 'trace-to-pop';

      pushTraceIdForRun(runId, traceId);

      // First pop returns the trace ID
      expect(popTraceIdForRun(runId)).toBe(traceId);

      // Second pop returns undefined (already removed)
      expect(popTraceIdForRun(runId)).toBeUndefined();
    });

    test('returns undefined for unknown runId', () => {
      const unknownRunId = uniqueId();

      expect(popTraceIdForRun(unknownRunId)).toBeUndefined();
    });

    test('only removes the requested runId', () => {
      const runId1 = uniqueId();
      const runId2 = uniqueId();
      const traceId1 = 'trace-1';
      const traceId2 = 'trace-2';

      pushTraceIdForRun(runId1, traceId1);
      pushTraceIdForRun(runId2, traceId2);

      // Pop first runId
      expect(popTraceIdForRun(runId1)).toBe(traceId1);

      // Second runId should still be available
      expect(popTraceIdForRun(runId2)).toBe(traceId2);
    });
  });
});
