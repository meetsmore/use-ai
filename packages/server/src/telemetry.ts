import { trace, context as otelContext, SpanStatusCode } from '@opentelemetry/api';
import { flushTracing, langfuse, popTraceIdForRun, recordErrorTrace, type ErrorTraceParams } from './instrumentation';

/**
 * Backend-agnostic telemetry handle for a single agent run.
 * Wraps OpenTelemetry span creation and Langfuse-specific helpers
 * so that agent code never imports OTEL or instrumentation directly.
 */
export interface RunSpan {
  /** Whether telemetry is active (use for `experimental_telemetry` gating). */
  readonly active: boolean;

  /** Execute `fn` within the parent OTEL context so child spans are grouped. */
  wrap<T>(fn: () => T): T;

  /** Set the input attribute on the span (shown in Langfuse list view). */
  setInput(value: unknown): void;

  /** Set the output attribute on the span (shown in Langfuse list view). */
  setOutput(value: unknown): void;

  /** Set OK status, end the OTEL span, and clean up the trace ID. */
  end(): void;

  /** Set ERROR status, end the OTEL span, and clean up the trace ID. */
  endWithError(message: string): void;

  /** Get the trace ID captured by the span processor (for RUN_FINISHED events). */
  popTraceId(): string | undefined;

  /** Fire-and-forget error trace recording (pre-streamText errors). */
  recordError(params: ErrorTraceParams): void;
}

interface StartRunSpanConfig {
  runId: string;
  sessionId: string;
  attributes?: Record<string, string>;
}

/**
 * Creates a `RunSpan` that groups all step iterations under one OTEL trace.
 * Returns a no-op implementation when telemetry is disabled (zero overhead).
 */
export function startRunSpan(config: StartRunSpanConfig): RunSpan {
  const { runId, sessionId } = config;

  if (!langfuse.enabled) {
    return {
      active: false,
      wrap: <T>(fn: () => T): T => fn(),
      setInput: () => {},
      setOutput: () => {},
      end: () => { popTraceIdForRun(runId); },
      endWithError: () => { popTraceIdForRun(runId); },
      popTraceId: () => popTraceIdForRun(runId),
      recordError: () => {},
    };
  }

  const parentSpan = trace.getTracer('use-ai').startSpan('use-ai.agent.run', {
    attributes: {
      'ai.telemetry.functionId': 'use-ai',
      'ai.telemetry.metadata.runId': runId,
      'ai.telemetry.metadata.sessionId': sessionId,
      ...config.attributes,
    },
  });
  const parentOtelContext = trace.setSpan(otelContext.active(), parentSpan);

  return {
    active: true,

    wrap<T>(fn: () => T): T {
      return otelContext.with(parentOtelContext, fn);
    },

    setInput(value: unknown) {
      parentSpan.setAttribute(
        'langfuse.observation.input',
        typeof value === 'string' ? value : JSON.stringify(value),
      );
    },

    setOutput(value: unknown) {
      parentSpan.setAttribute(
        'langfuse.observation.output',
        typeof value === 'string' ? value : JSON.stringify(value),
      );
    },

    end() {
      parentSpan.setStatus({ code: SpanStatusCode.OK });
      parentSpan.end();
      popTraceIdForRun(runId);
    },

    endWithError(message: string) {
      parentSpan.setStatus({ code: SpanStatusCode.ERROR, message });
      parentSpan.end();
      popTraceIdForRun(runId);
    },

    popTraceId() {
      return popTraceIdForRun(runId);
    },

    recordError(params: ErrorTraceParams) {
      recordErrorTrace(params);
    },
  };
}

/**
 * Flushes all pending telemetry data.
 * Flushes both OTel span processors and any direct Langfuse SDK writes.
 */
export async function flushTelemetry(): Promise<void> {
  await flushTracing();
  await langfuse.client?.flushAsync();
}
