/**
 * Unit tests for instrumentation.ts trace ID storage functions and error tracing.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { pushTraceIdForRun, popTraceIdForRun, recordErrorTrace, langfuse, _createLangfuseSpanProcessor } from './instrumentation';

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

  const { BasicTracerProvider, InMemorySpanExporter } = require('@opentelemetry/sdk-trace-node');
  const { setLangfuseTracerProvider, LangfuseOtelSpanAttributes: A } = require('@langfuse/tracing');
  const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
  const { context: otelContext } = require('@opentelemetry/api');

  let exporter: InstanceType<typeof InMemorySpanExporter>;
  let provider: InstanceType<typeof BasicTracerProvider>;
  let originalEnabled: boolean;
  let contextManagerRegistered: boolean;
  const finishedSpans = async () => {
    await provider.forceFlush();
    return exporter.getFinishedSpans();
  };

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({ spanProcessors: [_createLangfuseSpanProcessor({ exporter })] });
    setLangfuseTracerProvider(provider);
    originalEnabled = langfuse.enabled;
    contextManagerRegistered = otelContext.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  afterEach(async () => {
    if (contextManagerRegistered) otelContext.disable();
    langfuse.enabled = originalEnabled;
    setLangfuseTracerProvider(null);
    await provider.shutdown();
  });

  test('is a no-op when Langfuse is disabled', async () => {
    langfuse.enabled = false;

    expect(() => recordErrorTrace(baseParams)).not.toThrow();
    expect(await finishedSpans()).toHaveLength(0);
  });

  test('exports a use-ai-error trace with an ERROR child span', async () => {
    langfuse.enabled = true;

    recordErrorTrace({ ...baseParams, metadata: { requestedAgent: 'foo', toolCount: 3 } });

    const spans = await finishedSpans();
    const root = spans.find((s: { name: string }) => s.name === 'use-ai-error');
    const child = spans.find((s: { name: string }) => s.name === 'agent_not_found');
    expect(root).toBeDefined();
    expect(child).toBeDefined();

    expect(root.attributes[A.TRACE_NAME]).toBe('use-ai-error');
    expect(root.attributes[A.TRACE_SESSION_ID]).toBe('client-1');
    expect(root.attributes[A.TRACE_TAGS]).toEqual(['error', 'agent_not_found']);
    expect(root.attributes[`${A.TRACE_METADATA}.runId`]).toBe('run-123');
    expect(root.attributes[`${A.TRACE_METADATA}.errorCategory`]).toBe('agent_not_found');
    expect(root.attributes[`${A.TRACE_METADATA}.ipAddress`]).toBe('127.0.0.1');
    expect(root.attributes[`${A.TRACE_METADATA}.source`]).toBe('use-ai-server');
    expect(root.attributes[`${A.TRACE_METADATA}.requestedAgent`]).toBe('foo');
    expect(root.attributes[`${A.TRACE_METADATA}.toolCount`]).toBe('3');
    expect(JSON.parse(root.attributes[A.OBSERVATION_INPUT])).toEqual({ threadId: 'thread-abc', errorCategory: 'agent_not_found' });
    expect(JSON.parse(root.attributes[A.OBSERVATION_OUTPUT])).toEqual({ error: 'Agent "foo" not found' });

    expect(child.attributes[A.OBSERVATION_LEVEL]).toBe('ERROR');
    expect(child.attributes[A.OBSERVATION_STATUS_MESSAGE]).toBe('Agent "foo" not found');
    expect(child.parentSpanContext.spanId).toBe(root.spanContext().spanId);
    expect(child.spanContext().traceId).toBe(root.spanContext().traceId);
  });

  test('starts a new trace even when called inside an active span', async () => {
    langfuse.enabled = true;
    const { trace } = require('@opentelemetry/api');
    const outer = provider.getTracer('test').startSpan('outer');

    otelContext.with(trace.setSpan(otelContext.active(), outer), () => recordErrorTrace(baseParams));
    outer.end();

    const root = (await finishedSpans()).find((s: { name: string }) => s.name === 'use-ai-error');
    expect(root.parentSpanContext).toBeUndefined();
    expect(root.spanContext().traceId).not.toBe(outer.spanContext().traceId);
  });

  test('does not propagate errors from the tracer', () => {
    langfuse.enabled = true;
    setLangfuseTracerProvider({ getTracer: () => { throw new Error('tracer failed'); } });

    expect(() => recordErrorTrace(baseParams)).not.toThrow();
  });
});

describe('Langfuse span processor', () => {
  test('exports the use-ai.agent.run parent span with AI SDK spans nested under it', async () => {
    const { BasicTracerProvider, InMemorySpanExporter } = require('@opentelemetry/sdk-trace-node');
    const { context: otelContext, trace } = require('@opentelemetry/api');

    const exporter = new InMemorySpanExporter();
    const processor = _createLangfuseSpanProcessor({ exporter });
    const provider = new BasicTracerProvider({ spanProcessors: [processor] });

    const parent = provider.getTracer('use-ai').startSpan('use-ai.agent.run');
    const parentContext = trace.setSpan(otelContext.active(), parent);
    const child = provider.getTracer('ai').startSpan('ai.streamText', {}, parentContext);
    child.end();
    parent.end();
    await processor.forceFlush();

    const spans = exporter.getFinishedSpans();
    const exportedParent = spans.find((s: { name: string }) => s.name === 'use-ai.agent.run');
    const exportedChild = spans.find((s: { name: string }) => s.name === 'ai.streamText');
    expect(exportedParent).toBeDefined();
    expect(exportedChild).toBeDefined();
    expect(exportedChild.parentSpanContext.spanId).toBe(exportedParent.spanContext().spanId);
    await provider.shutdown();
  });
});
