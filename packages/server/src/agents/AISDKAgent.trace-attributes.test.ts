import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { context as otelContext, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-node';
import { LangfuseOtelSpanAttributes as A } from '@langfuse/tracing';
import { MockLanguageModelV3 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import { v4 as uuidv4 } from 'uuid';
import { AISDKAgent } from './AISDKAgent';
import type { AgentInput } from './types';
import { _createLangfuseSpanProcessor, langfuse, type SpanProcessor } from '../instrumentation';

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
      spanProcessors: [_createLangfuseSpanProcessor({ exporter }), tagFromMetadataProcessor],
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
});
