import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { context as otelContext, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-node';
import { LangfuseOtelSpanAttributes as A, propagateAttributes } from '@langfuse/tracing';
import { MockLanguageModelV3 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { v4 as uuidv4 } from 'uuid';
import { AISDKAgent } from './AISDKAgent';
import type { AgentInput } from './types';
import { _createLangfuseSpanProcessor, _createTraceIdCaptureProcessor, langfuse, popTraceIdForRun, USE_AI_TRACER_NAME, type SpanProcessor } from '../instrumentation';
import { startRunSpan } from '../telemetry';

/**
 * Host span processor that derives Langfuse tags from AI SDK telemetry metadata at span start,
 * the way a consuming app (e.g. ProOne apps/ai) registers it through `spanProcessors`.
 */
const tagFromMetadataProcessor: SpanProcessor = {
  onStart(span: { attributes?: Record<string, unknown>; setAttribute(key: string, value: unknown): void }) {
    const tags: string[] = [];
    const product = span.attributes?.['ai.telemetry.metadata.product'];
    const tenantKey = span.attributes?.['ai.telemetry.metadata.tenantKey'];
    if (typeof product === 'string') tags.push(product);
    if (typeof tenantKey === 'string') tags.push(`tenant:${tenantKey}`);
    if (tags.length > 0) span.setAttribute(A.TRACE_TAGS, tags);
  },
  onEnd() {},
  shutdown: () => Promise.resolve(),
  forceFlush: () => Promise.resolve(),
};

function createModel() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'Hi' },
          { type: 'text-end', id: 'text-1' },
          { type: 'finish', finishReason: 'stop' as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
        ],
      }),
    }),
  });
}

function createInput(telemetryMetadata: Record<string, unknown>): AgentInput {
  const runId = uuidv4();
  return {
    session: {
      socket: {} as never,
      clientId: 'client-1',
      threadId: 'thread-1',
      tools: [],
      state: null,
      pendingToolCalls: new Map(),
      pendingToolApprovals: new Map(),
      ipAddress: '127.0.0.1',
    },
    runId,
    messages: [{ role: 'user', content: 'Hello' }],
    tools: [],
    state: null,
    originalInput: {
      threadId: 'thread-1',
      runId,
      messages: [{ id: uuidv4(), role: 'user', content: 'Hello' }],
      tools: [],
      state: null,
      context: [],
      forwardedProps: { telemetryMetadata },
    },
  };
}

describe('AISDKAgent trace-level attributes', () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let originalEnabled: boolean;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [_createTraceIdCaptureProcessor(), _createLangfuseSpanProcessor({ exporter }), tagFromMetadataProcessor],
    });
    trace.disable();
    otelContext.disable();
    expect(trace.setGlobalTracerProvider(provider)).toBe(true);
    expect(otelContext.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())).toBe(true);
    originalEnabled = langfuse.enabled;
    langfuse.enabled = true;
  });

  afterEach(async () => {
    langfuse.enabled = originalEnabled;
    otelContext.disable();
    trace.disable();
    await provider.shutdown();
  });

  test('root and every child observation carry the trace name and the tags', async () => {
    const agent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: createModel() }) } });

    await agent.run(createInput({ product: 'Proone', tenantKey: 'acme' }), { emit: () => {} });
    await provider.forceFlush();

    const spans: ReadableSpan[] = exporter.getFinishedSpans();
    const root = spans.find(s => s.name === 'use-ai.agent.run');
    expect(root).toBeDefined();
    const runSpans = spans.filter(s => s.spanContext().traceId === root!.spanContext().traceId);
    expect(runSpans.map(s => s.name)).toEqual(expect.arrayContaining(['use-ai.agent.run', 'ai.streamText', 'ai.streamText.doStream']));

    for (const span of runSpans) {
      expect({ span: span.name, traceName: span.attributes[A.TRACE_NAME] })
        .toEqual({ span: span.name, traceName: 'use-ai.agent.run' });
      expect({ span: span.name, tags: span.attributes[A.TRACE_TAGS] })
        .toEqual({ span: span.name, tags: ['Proone', 'tenant:acme'] });
    }
  });

  test('telemetryMetadata does not override the run span session id fallback', async () => {
    const agent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: createModel() }) } });

    await agent.run(createInput({ product: 'Proone', sessionId: '' }), { emit: () => {} });
    await provider.forceFlush();

    const root = exporter.getFinishedSpans().find(s => s.name === 'use-ai.agent.run');
    expect(root?.attributes['ai.telemetry.metadata.sessionId']).toBe('client-1');
  });

  describe('client telemetryMetadata cannot replace server-owned metadata', () => {
    const spoofed = {
      runId: 'spoofed-run',
      threadId: 'spoofed-thread',
      ipAddress: '203.0.113.9',
      toolCount: 99,
      stepIteration: 99,
      gracefulSummary: true,
      truncationFallback: true,
      userId: 'user-1',
    };

    async function runSpans(input: AgentInput): Promise<ReadableSpan[]> {
      const agent = new AISDKAgent({ hooks: { loadConfig: () => ({ model: createModel() }) } });
      await agent.run(input, { emit: () => {} });
      await provider.forceFlush();
      const spans = exporter.getFinishedSpans();
      const root = spans.find(s => s.name === 'use-ai.agent.run');
      expect(root).toBeDefined();
      return spans.filter(s => s.spanContext().traceId === root!.spanContext().traceId);
    }

    test('the run span and every AI SDK span keep the server run id, thread id and IP address', async () => {
      const input = createInput(spoofed);
      const spans = await runSpans(input);
      const withMetadata = spans.filter(s => s.attributes['ai.telemetry.metadata.runId'] !== undefined);
      expect(withMetadata.map(s => s.name)).toEqual(expect.arrayContaining(['use-ai.agent.run', 'ai.streamText']));

      for (const span of withMetadata) {
        const m = (key: string) => span.attributes[`ai.telemetry.metadata.${key}`];
        expect({ span: span.name, runId: m('runId'), threadId: m('threadId'), ipAddress: m('ipAddress'), userId: m('userId') })
          .toEqual({ span: span.name, runId: input.runId, threadId: 'thread-1', ipAddress: '127.0.0.1', userId: 'user-1' });
      }
      const streamText = withMetadata.find(s => s.name === 'ai.streamText')!;
      expect(streamText.attributes['ai.telemetry.metadata.toolCount']).toBe(0);
      expect(streamText.attributes['ai.telemetry.metadata.stepIteration']).toBe(0);
      for (const span of withMetadata) {
        const m = (key: string) => span.attributes[`ai.telemetry.metadata.${key}`];
        expect({ span: span.name, gracefulSummary: m('gracefulSummary'), truncationFallback: m('truncationFallback') })
          .toEqual({ span: span.name, gracefulSummary: undefined, truncationFallback: undefined });
      }
      const root = withMetadata.find(s => s.name === 'use-ai.agent.run')!;
      expect(root.attributes['ai.telemetry.metadata.toolCount']).toBeUndefined();
    });

    test('a client ipAddress is dropped when the server has none', async () => {
      const input = createInput({ ipAddress: '203.0.113.9' });
      input.session.ipAddress = undefined;
      const spans = await runSpans(input);

      for (const span of spans) {
        expect({ span: span.name, ipAddress: span.attributes['ai.telemetry.metadata.ipAddress'] })
          .toEqual({ span: span.name, ipAddress: undefined });
      }
    });

    test('a client runId leaves no trace id entry behind after the run', async () => {
      const input = createInput(spoofed);
      await runSpans(input);

      expect(popTraceIdForRun('spoofed-run')).toBeUndefined();
      expect(popTraceIdForRun(input.runId)).toBeUndefined();
    });

    test('client keys the server does not set on spans (errorCode, messageCount) are kept', async () => {
      const spans = await runSpans(createInput({ errorCode: 'app-code', messageCount: 12 }));
      const streamText = spans.find(s => s.name === 'ai.streamText')!;
      expect(streamText.attributes['ai.telemetry.metadata.errorCode']).toBe('app-code');
      expect(streamText.attributes['ai.telemetry.metadata.messageCount']).toBe(12);
    });

    test('the run span and every AI SDK span share the client sessionId', async () => {
      const spans = await runSpans(createInput({ sessionId: 'chat-42' }));
      const withMetadata = spans.filter(s => s.attributes['ai.telemetry.metadata.runId'] !== undefined);
      expect(withMetadata.length).toBeGreaterThan(1);

      for (const span of withMetadata) {
        expect({ span: span.name, sessionId: span.attributes['ai.telemetry.metadata.sessionId'] })
          .toEqual({ span: span.name, sessionId: 'chat-42' });
      }
    });
  });

  test('startRunSpan config.attributes override the default run span attributes', async () => {
    const span = startRunSpan({
      runId: 'run-1',
      sessionId: 'session-1',
      attributes: {
        'ai.telemetry.functionId': 'custom-agent',
        'ai.telemetry.metadata.runId': 'run-override',
        'ai.telemetry.metadata.sessionId': 'session-override',
      },
    });
    span.end();
    await provider.forceFlush();

    const root = exporter.getFinishedSpans().find(s => s.name === 'use-ai.agent.run');
    expect(root?.attributes).toMatchObject({
      'ai.telemetry.functionId': 'custom-agent',
      'ai.telemetry.metadata.runId': 'run-override',
      'ai.telemetry.metadata.sessionId': 'session-override',
    });
  });

  test('a trace name propagated by the caller wins over use-ai.agent.run', async () => {
    propagateAttributes({ traceName: 'host-trace' }, () => {
      const span = startRunSpan({ runId: 'run-1', sessionId: 'session-1' });
      span.wrap(() => trace.getTracer(USE_AI_TRACER_NAME).startSpan('child').end());
      span.end();
    });
    await provider.forceFlush();

    const names = exporter.getFinishedSpans().map(s => ({ span: s.name, traceName: s.attributes[A.TRACE_NAME] }));
    expect(names).toEqual(expect.arrayContaining([
      { span: 'use-ai.agent.run', traceName: 'host-trace' },
      { span: 'child', traceName: 'host-trace' },
    ]));
  });
});
