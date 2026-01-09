import { logger } from './logger.js';

export interface LangfuseConfig {
  enabled: boolean;
  spanProcessor?: {
    forceFlush(): Promise<void>;
  };
  flush?: () => Promise<void>;
}

/**
 * Initializes Langfuse observability using OpenTelemetry.
 * Only activates if LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set.
 *
 * @returns Configuration object indicating if Langfuse is enabled
 */
export function initializeLangfuse(): LangfuseConfig {
  const enabled = Boolean(
    process.env.LANGFUSE_PUBLIC_KEY &&
    process.env.LANGFUSE_SECRET_KEY
  );

  if (!enabled) {
    return { enabled: false };
  }

  try {
    // Dynamically import Langfuse dependencies
    // This prevents errors if packages aren't installed
    const { LangfuseSpanProcessor } = require('@langfuse/otel');
    const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');

    const langfuseSpanProcessor = new LangfuseSpanProcessor({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
      secretKey: process.env.LANGFUSE_SECRET_KEY!,
      baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
    });

    const tracerProvider = new NodeTracerProvider({
      spanProcessors: [langfuseSpanProcessor],
    });

    tracerProvider.register();

    logger.info('Langfuse observability initialized', {
      baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
    });

    return {
      enabled: true,
      spanProcessor: langfuseSpanProcessor,
      flush: async () => {
        await langfuseSpanProcessor.forceFlush();
      },
    };
  } catch (error) {
    logger.warn('Failed to initialize Langfuse. Install @langfuse/otel and @opentelemetry/sdk-trace-node to enable observability.', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { enabled: false };
  }
}
