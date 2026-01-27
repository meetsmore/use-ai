import { Langfuse } from 'langfuse';
import { logger } from './logger.js';

// Store trace IDs by runId for feedback linking
const traceIdByRunId = new Map<string, string>();

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
 * Initializes Langfuse observability using OpenTelemetry.
 * Only activates if LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set.
 */
export function initializeLangfuse(): LangfuseApi {
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
