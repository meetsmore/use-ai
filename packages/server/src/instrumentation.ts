import { Langfuse } from 'langfuse';
import { logger } from './logger.js';

// Store trace IDs by runId for feedback linking
const traceIdByRunId = new Map<string, string>();

/**
 * OpenTelemetry SpanProcessor interface.
 * Matches the @opentelemetry/sdk-trace-base SpanProcessor interface
 * so users don't need to import the OTel package to implement custom processors.
 */
export interface SpanProcessor {
  onStart(span: { spanContext(): { traceId: string }; attributes?: Record<string, unknown> }): void;
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
  client?: Langfuse;
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
 * Records a pre-streamText error as a Langfuse trace.
 * Uses the Langfuse SDK directly (same pattern as FeedbackPlugin).
 * Fire-and-forget: errors are caught and logged, never propagated.
 */
export function recordErrorTrace(params: ErrorTraceParams): void {
  if (!langfuse.enabled || !langfuse.client) return;
  try {
    const trace = langfuse.client.trace({
      id: params.runId,
      name: 'use-ai-error',
      sessionId: params.sessionId,
      input: { threadId: params.threadId, errorCategory: params.errorCategory },
      output: { error: params.errorMessage },
      metadata: {
        errorCategory: params.errorCategory,
        ipAddress: params.ipAddress,
        source: 'use-ai-server',
        ...params.metadata,
      },
      tags: ['error', params.errorCategory],
    });

    // Create a child span with level: ERROR so the trace is surfaced as ERROR in Langfuse UI.
    // Without this, the trace would remain at DEFAULT level since traces don't have a level property.
    trace.span({
      name: params.errorCategory,
      level: 'ERROR',
      statusMessage: params.errorMessage,
      input: { threadId: params.threadId, errorCategory: params.errorCategory },
      output: { error: params.errorMessage },
    });
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
      onStart(span: { spanContext(): { traceId: string }; attributes?: Record<string, unknown> }) {
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
      const { LangfuseSpanProcessor } = require('@langfuse/otel');
      langfuseSpanProcessor = new LangfuseSpanProcessor({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
        secretKey: process.env.LANGFUSE_SECRET_KEY!,
        baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
        release: process.env.LANGFUSE_RELEASE || 'use-ai-test',
      }) as SpanProcessor;
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
  const release = process.env.LANGFUSE_RELEASE || 'use-ai-test';

  const client = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    baseUrl,
    release,
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
