/**
 * Unit tests for instrumentation.ts trace ID storage functions and error tracing.
 */

import { describe, expect, test, beforeEach, mock, spyOn } from 'bun:test';
import { pushTraceIdForRun, popTraceIdForRun, recordErrorTrace, langfuse } from './instrumentation';

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

describe('recordErrorTrace', () => {
  const baseParams = {
    runId: 'run-123',
    errorCategory: 'agent_not_found' as const,
    errorMessage: 'Agent "foo" not found',
    sessionId: 'client-1',
    threadId: 'thread-abc',
    ipAddress: '127.0.0.1',
  };

  test('is a no-op when Langfuse is disabled (does not throw)', () => {
    const originalEnabled = langfuse.enabled;
    const originalClient = langfuse.client;
    try {
      langfuse.enabled = false;
      langfuse.client = undefined;
      // Should not throw
      expect(() => recordErrorTrace(baseParams)).not.toThrow();
    } finally {
      langfuse.enabled = originalEnabled;
      langfuse.client = originalClient;
    }
  });

  test('calls langfuse.client.trace() with correct arguments and creates error span', () => {
    const originalEnabled = langfuse.enabled;
    const originalClient = langfuse.client;
    const mockSpan = mock(() => {});
    const mockTrace = mock(() => ({ span: mockSpan }));
    try {
      langfuse.enabled = true;
      langfuse.client = { trace: mockTrace } as any;

      recordErrorTrace({
        ...baseParams,
        metadata: { requestedAgent: 'foo' },
      });

      expect(mockTrace).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const calls = mockTrace.mock.calls as any[][];
      const call = calls[0][0];
      expect(call.id).toBe('run-123');
      expect(call.name).toBe('use-ai-error');
      expect(call.sessionId).toBe('client-1');
      expect(call.input).toEqual({ threadId: 'thread-abc', errorCategory: 'agent_not_found' });
      expect(call.output).toEqual({ error: 'Agent "foo" not found' });
      expect(call.tags).toEqual(['error', 'agent_not_found']);
      expect(call.metadata.errorCategory).toBe('agent_not_found');
      expect(call.metadata.ipAddress).toBe('127.0.0.1');
      expect(call.metadata.source).toBe('use-ai-server');
      expect(call.metadata.requestedAgent).toBe('foo');

      // Verify child span was created with ERROR level
      expect(mockSpan).toHaveBeenCalledTimes(1);
      const spanCalls = mockSpan.mock.calls as any[][];
      const spanCall = spanCalls[0][0];
      expect(spanCall.name).toBe('agent_not_found');
      expect(spanCall.level).toBe('ERROR');
      expect(spanCall.statusMessage).toBe('Agent "foo" not found');
    } finally {
      langfuse.enabled = originalEnabled;
      langfuse.client = originalClient;
    }
  });

  test('does not propagate errors when langfuse.client.trace() throws', () => {
    const originalEnabled = langfuse.enabled;
    const originalClient = langfuse.client;
    const mockTrace = mock((): never => { throw new Error('Langfuse connection failed'); });
    try {
      langfuse.enabled = true;
      langfuse.client = { trace: mockTrace } as any;

      // Should not throw even though trace() throws
      expect(() => recordErrorTrace(baseParams)).not.toThrow();
      expect(mockTrace).toHaveBeenCalledTimes(1);
    } finally {
      langfuse.enabled = originalEnabled;
      langfuse.client = originalClient;
    }
  });

  test('does not propagate errors when trace.span() throws', () => {
    const originalEnabled = langfuse.enabled;
    const originalClient = langfuse.client;
    const mockSpan = mock((): never => { throw new Error('Span creation failed'); });
    const mockTrace = mock(() => ({ span: mockSpan }));
    try {
      langfuse.enabled = true;
      langfuse.client = { trace: mockTrace } as any;

      // Should not throw even though span() throws
      expect(() => recordErrorTrace(baseParams)).not.toThrow();
      expect(mockTrace).toHaveBeenCalledTimes(1);
      expect(mockSpan).toHaveBeenCalledTimes(1);
    } finally {
      langfuse.enabled = originalEnabled;
      langfuse.client = originalClient;
    }
  });

  test('is a no-op when enabled but client is undefined', () => {
    const originalEnabled = langfuse.enabled;
    const originalClient = langfuse.client;
    try {
      langfuse.enabled = true;
      langfuse.client = undefined;
      expect(() => recordErrorTrace(baseParams)).not.toThrow();
    } finally {
      langfuse.enabled = originalEnabled;
      langfuse.client = originalClient;
    }
  });
});
