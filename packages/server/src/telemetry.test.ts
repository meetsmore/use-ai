import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { pushTraceIdForRun, popTraceIdForRun } from './instrumentation';

// Mock @opentelemetry/api before importing telemetry module
const mockSpanEnd = mock(() => {});
const mockSpanSetStatus = mock((_status: { code: number; message?: string }) => {});
const mockSpan = {
  end: mockSpanEnd,
  setStatus: mockSpanSetStatus,
  spanContext: () => ({ traceId: 'mock-trace-id' }),
};

const mockStartSpan = mock((_name: string, _options?: unknown) => mockSpan);
const mockGetTracer = mock((_name: string) => ({ startSpan: mockStartSpan }));

const mockWithContext = mock(<T>(_ctx: unknown, fn: () => T): T => fn());
const mockActiveContext = mock(() => ({}));
const mockSetSpan = mock((_ctx: unknown, _span: unknown) => ({ parentCtx: true }));

mock.module('@opentelemetry/api', () => ({
  trace: {
    getTracer: mockGetTracer,
    setSpan: mockSetSpan,
  },
  context: {
    with: mockWithContext,
    active: mockActiveContext,
  },
  SpanStatusCode: {
    OK: 1,
    ERROR: 2,
  },
}));

// Must import after mocking
import { startRunSpan, flushTelemetry } from './telemetry';

describe('telemetry', () => {
  beforeEach(() => {
    mockSpanEnd.mockClear();
    mockSpanSetStatus.mockClear();
    mockStartSpan.mockClear();
    mockGetTracer.mockClear();
    mockWithContext.mockClear();
    mockActiveContext.mockClear();
    mockSetSpan.mockClear();
  });

  describe('startRunSpan (telemetry disabled)', () => {
    test('returns inactive span when telemetry is disabled', () => {
      // langfuse.enabled is false by default in test environment (no env vars)
      const span = startRunSpan({ runId: 'run-1', sessionId: 'session-1' });
      expect(span.active).toBe(false);
    });

    test('wrap() passes through the function return value', () => {
      const span = startRunSpan({ runId: 'run-1', sessionId: 'session-1' });
      const result = span.wrap(() => 42);
      expect(result).toBe(42);
    });

    test('end() cleans up trace IDs even when telemetry is disabled', () => {
      // Pre-populate a trace ID
      pushTraceIdForRun('run-cleanup-end', 'trace-abc');

      const span = startRunSpan({ runId: 'run-cleanup-end', sessionId: 'session-1' });
      span.end();

      // Trace ID should have been cleaned up
      expect(popTraceIdForRun('run-cleanup-end')).toBeUndefined();
    });

    test('endWithError() cleans up trace IDs even when telemetry is disabled', () => {
      pushTraceIdForRun('run-cleanup-err', 'trace-def');

      const span = startRunSpan({ runId: 'run-cleanup-err', sessionId: 'session-1' });
      span.endWithError('something went wrong');

      expect(popTraceIdForRun('run-cleanup-err')).toBeUndefined();
    });

    test('popTraceId() delegates to popTraceIdForRun', () => {
      pushTraceIdForRun('run-pop', 'trace-xyz');

      const span = startRunSpan({ runId: 'run-pop', sessionId: 'session-1' });
      const traceId = span.popTraceId();

      expect(traceId).toBe('trace-xyz');
      // Second call returns undefined (already popped)
      expect(span.popTraceId()).toBeUndefined();
    });

    test('recordError() does not throw when telemetry is disabled', () => {
      const span = startRunSpan({ runId: 'run-err', sessionId: 'session-1' });
      // Should be a no-op, not throw
      expect(() =>
        span.recordError({
          runId: 'run-err',
          errorCategory: 'pre_stream_error',
          errorMessage: 'test error',
          sessionId: 'session-1',
        })
      ).not.toThrow();
    });

    test('setInput() and setOutput() do not throw when disabled', () => {
      const span = startRunSpan({ runId: 'run-io', sessionId: 'session-1' });
      expect(() => span.setInput('hello')).not.toThrow();
      expect(() => span.setOutput('world')).not.toThrow();
    });

    test('end() does not create OTEL spans when disabled', () => {
      const span = startRunSpan({ runId: 'run-no-otel', sessionId: 'session-1' });
      span.end();

      // No OTEL tracer should have been obtained
      expect(mockGetTracer).not.toHaveBeenCalled();
    });
  });

  describe('popTraceId', () => {
    test('returns undefined when no trace ID was pushed', () => {
      const span = startRunSpan({ runId: 'run-no-trace', sessionId: 'session-1' });
      expect(span.popTraceId()).toBeUndefined();
    });
  });

  describe('flushTelemetry', () => {
    test('resolves without error when telemetry is disabled', async () => {
      // langfuse.flush is undefined when disabled — flushTelemetry should handle gracefully
      await expect(flushTelemetry()).resolves.toBeUndefined();
    });
  });
});
