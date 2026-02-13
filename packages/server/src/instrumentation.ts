import { Langfuse } from 'langfuse';
import { logger } from './logger.js';

// Store trace IDs by runId for feedback linking
const traceIdByRunId = new Map<string, string>();

// Initialize Langfuse observability using OpenTelemetry.
// Only activates if LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set.
export const langfuse = _initializeLangfuse();

export interface LangfuseApi {
  enabled: boolean;
  /** Langfuse SDK client for score operations */
  client?: Langfuse;
  flush?: () => Promise<void>;
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
  /** Error-specific metadata (e.g. requestedAgent, retryAfterSeconds). Goes to top-level trace metadata. */
  metadata?: Record<string, unknown>;
  /** Forwarded telemetry metadata (e.g. userId, tenantId). Nested under metadata.attributes.ai.telemetry.metadata. */
  telemetryMetadata?: Record<string, unknown>;
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
        ...(params.telemetryMetadata && Object.keys(params.telemetryMetadata).length > 0
          ? { attributes: { 'ai.telemetry.metadata': params.telemetryMetadata } }
          : {}),
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
 * Initializes Langfuse observability using OpenTelemetry.
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

  // Create Langfuse SDK client for score operations
  const langfuseClient = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    baseUrl,
    release,
  });

  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { LangfuseSpanProcessor } = require('@langfuse/otel');

    const langfuseSpanProcessor = new LangfuseSpanProcessor({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
      secretKey: process.env.LANGFUSE_SECRET_KEY!,
      baseUrl,
      release,
    });

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

    const sdk = new NodeSDK({
      spanProcessors: [traceIdCaptureProcessor as unknown as typeof langfuseSpanProcessor, langfuseSpanProcessor],
    });

    sdk.start();

    logger.info('Langfuse observability initialized', { baseUrl, release });

    return {
      enabled: true,
      client: langfuseClient,
      flush: async () => {
        await langfuseSpanProcessor.forceFlush();
        await langfuseClient.flushAsync();
      },
    };
  } catch (error) {
    logger.warn('Failed to initialize Langfuse OTEL. Install @langfuse/otel and @opentelemetry/sdk-node for tracing.', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      enabled: true,
      client: langfuseClient,
      flush: async () => {
        await langfuseClient.flushAsync();
      },
    };
  }
}
