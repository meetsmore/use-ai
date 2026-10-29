import { LangfuseClient } from '@langfuse/client';
import { propagateAttributes, startObservation } from '@langfuse/tracing';
import { context as otelContext, ROOT_CONTEXT } from '@opentelemetry/api';
import { logger } from './logger.js';

/** OTel tracer name for spans created by use-ai (e.g. `use-ai.agent.run`). */
export const USE_AI_TRACER_NAME = 'use-ai';

// Store trace IDs by runId for feedback linking
const traceIdByRunId = new Map<string, string>();

/**
 * OpenTelemetry SpanProcessor interface.
 * Matches the @opentelemetry/sdk-trace-base SpanProcessor interface
 * so users don't need to import the OTel package to implement custom processors.
 */
export interface SpanProcessor {
  onStart(span: { spanContext(): { traceId: string }; attributes?: Record<string, unknown>; setAttribute(key: string, value: unknown): void }): void;
  onEnd(span: unknown): void;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
}

// Initialize Langfuse client.
// Only activates if LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set.
// OTel tracing is started separately via `startTracing()`.
export const langfuse = _initializeLangfuse();

export interface LangfuseApi {
  enabled: boolean;
  /** Langfuse SDK client for score operations */
  client?: LangfuseClient;
}

/**
 * Store a trace ID for a given runId (called by span processor).
 */
export function pushTraceIdForRun(runId: string, traceId: string): void {
  traceIdByRunId.set(runId, traceId);
}

/**
 * Get and remove the trace ID for a given runId.
 * Removes from state since it should only be needed once (client stores it with the message).
 */
export function popTraceIdForRun(runId: string): string | undefined {
  const traceId = traceIdByRunId.get(runId);
  if (traceId) {
    traceIdByRunId.delete(runId);
  }
  return traceId;
}

/**
 * Parameters for recording an error trace in Langfuse.
 */
export interface ErrorTraceParams {
  runId: string;
  errorCategory: 'agent_not_found' | 'rate_limit_exceeded' | 'unhandled_error' | 'pre_stream_error';
  errorMessage: string;
  sessionId: string;
  threadId?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Records a pre-streamText error as its own Langfuse trace, exported through OTel tracing.
 * Fire-and-forget: errors are caught and logged, never propagated.
 */
export function recordErrorTrace(params: ErrorTraceParams): void {
  if (!langfuse.enabled) return;
  try {
    const metadata: Record<string, string> = {};
    for (const [key, value] of Object.entries({
      runId: params.runId,
      errorCategory: params.errorCategory,
      ipAddress: params.ipAddress,
      source: 'use-ai-server',
      ...params.metadata,
    })) {
      if (value !== undefined) metadata[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    const input = { threadId: params.threadId, errorCategory: params.errorCategory };
    const output = { error: params.errorMessage };

    otelContext.with(ROOT_CONTEXT, () =>
      propagateAttributes(
        { traceName: 'use-ai-error', sessionId: params.sessionId, tags: ['error', params.errorCategory], metadata },
        () => {
          const root = startObservation('use-ai-error', { input, output });
          // The ERROR child surfaces the trace as ERROR in the Langfuse UI.
          root.startObservation(params.errorCategory, {
            level: 'ERROR',
            statusMessage: params.errorMessage,
            input,
            output,
          }).end();
          root.end();
        },
      ),
    );
  } catch (error) {
    logger.debug('Failed to record error trace in Langfuse', {
      error: error instanceof Error ? error.message : String(error),
      runId: params.runId,
    });
  }
}

/**
 * Whether OpenTelemetry tracing is active (Langfuse and/or custom span processors).
 * Used by AISDKAgent to decide whether to enable experimental_telemetry.
 */
let _tracingEnabled = false;

export function isTracingEnabled(): boolean {
  return _tracingEnabled;
}

/**
 * Starts OpenTelemetry tracing with Langfuse and optional custom span processors.
 * Called by UseAIServer constructor. Safe to call multiple times (no-op after first call).
 */
let _tracingStarted = false;
let _spanProcessors: SpanProcessor[] = [];

/**
 * Flushes all registered span processors (Langfuse + custom).
 * Called by AISDKAgent.flushTelemetry() during server shutdown.
 */
export async function flushTracing(): Promise<void> {
  await Promise.all(_spanProcessors.map(p => p.forceFlush()));
}

export function startTracing(customProcessors: SpanProcessor[] = []): void {
  if (_tracingStarted) return;
  _tracingStarted = true;

  if (!langfuse.enabled && customProcessors.length === 0) return;

  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');

    // Capture trace IDs from AI SDK spans for feedback linking
    const traceIdCaptureProcessor = {
      onStart(span: { spanContext(): { traceId: string }; attributes?: Record<string, unknown>; setAttribute(key: string, value: unknown): void }) {
        const runId = span.attributes?.['ai.telemetry.metadata.runId'] as string | undefined;
        if (runId) {
          pushTraceIdForRun(runId, span.spanContext().traceId);
        }
      },
      onEnd() { /** `popTraceIdForRun` is called in AISDKAgent when RUN_FINISHED is called. */ },
      shutdown() { return Promise.resolve(); },
      forceFlush() { return Promise.resolve(); },
    };

    const spanProcessors: SpanProcessor[] = [traceIdCaptureProcessor];

    let langfuseSpanProcessor: SpanProcessor | undefined;

    if (langfuse.enabled) {
      langfuseSpanProcessor = _createLangfuseSpanProcessor();
      spanProcessors.push(langfuseSpanProcessor);
    }

    spanProcessors.push(...customProcessors);

    const sdk = new NodeSDK({ spanProcessors });
    sdk.start();
    _tracingEnabled = true;

    // Store references for flushTracing()
    _spanProcessors = spanProcessors;

    logger.info('OpenTelemetry tracing started', {
      langfuseEnabled: langfuse.enabled,
      customProcessorCount: customProcessors.length,
    });
  } catch (error) {
    logger.warn('Failed to start OpenTelemetry tracing. Install @opentelemetry/sdk-node for tracing.', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Creates the Langfuse OTel span processor.
 * Exports Langfuse's default span set (LLM-related spans) plus spans from the `use-ai` tracer,
 * so AI SDK spans stay nested under `use-ai.agent.run`.
 * `exporter` replaces the default OTLP exporter. Only exported for testing purposes.
 */
export function _createLangfuseSpanProcessor(options: { exporter?: unknown } = {}): SpanProcessor {
  const { LangfuseSpanProcessor, isDefaultExportSpan } = require('@langfuse/otel');
  return new LangfuseSpanProcessor({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
    release: process.env.LANGFUSE_RELEASE || 'use-ai',
    exporter: options.exporter,
    shouldExportSpan: ({ otelSpan }: { otelSpan: { instrumentationScope: { name: string } } }) =>
      isDefaultExportSpan(otelSpan) || otelSpan.instrumentationScope.name === USE_AI_TRACER_NAME,
  }) as SpanProcessor;
}

/**
 * Initializes Langfuse client (without starting OTel tracing).
 * Only activates if LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set.
 * Only exported for testing purposes, you should use the `langfuse` singleton.
 */
export function _initializeLangfuse(): LangfuseApi {
  const enabled = Boolean(
    process.env.LANGFUSE_PUBLIC_KEY &&
    process.env.LANGFUSE_SECRET_KEY
  );

  if (!enabled) {
    return { enabled: false };
  }

  const baseUrl = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';

  const client = new LangfuseClient({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    baseUrl,
  });

  return {
    enabled: true,
    client,
  };
}

/**
 * Resets tracing state. Only for testing purposes.
 * @internal
 */
export function _resetTracing(): void {
  _tracingStarted = false;
  _tracingEnabled = false;
  _spanProcessors = [];
}
