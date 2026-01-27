import { Langfuse } from 'langfuse';
import type { UseAIServerPlugin, MessageHandler } from './types';
import type { ClientSession } from '../agents/types';
import type { UseAIClientMessage, FeedbackMessage } from '@meetsmore-oss/use-ai-core';
import { logger } from '../logger';

/**
 * Configuration for FeedbackPlugin.
 */
export interface FeedbackPluginConfig {
  /**
   * Langfuse public key. If not provided, falls back to LANGFUSE_PUBLIC_KEY env var.
   */
  publicKey?: string;

  /**
   * Langfuse secret key. If not provided, falls back to LANGFUSE_SECRET_KEY env var.
   */
  secretKey?: string;

  /**
   * Langfuse base URL. Defaults to LANGFUSE_BASE_URL env var or 'https://cloud.langfuse.com'.
   */
  baseUrl?: string;
}

/**
 * Plugin for user feedback on AI messages.
 *
 * This plugin enables thumbs up/down feedback buttons on AI messages in the chat UI.
 * Feedback is sent to Langfuse for tracking and analysis.
 *
 * Requires Langfuse credentials to be configured either via:
 * - Constructor config options
 * - Environment variables: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL
 *
 * @example
 * ```typescript
 * import { UseAIServer, AISDKAgent } from '@meetsmore-oss/use-ai-server';
 * import { FeedbackPlugin } from '@meetsmore-oss/use-ai-server';
 *
 * const server = new UseAIServer({
 *   agents: { claude: new AISDKAgent({ model }) },
 *   defaultAgent: 'claude',
 *   plugins: [
 *     new FeedbackPlugin(),
 *     // Or with explicit config:
 *     // new FeedbackPlugin({
 *     //   publicKey: 'pk-...',
 *     //   secretKey: 'sk-...',
 *     // }),
 *   ],
 * });
 * ```
 */
export class FeedbackPlugin implements UseAIServerPlugin {
  private langfuseClient: Langfuse | null = null;
  private enabled = false;

  constructor(config: FeedbackPluginConfig = {}) {
    const publicKey = config.publicKey || process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = config.secretKey || process.env.LANGFUSE_SECRET_KEY;
    const baseUrl = config.baseUrl || process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';

    if (!publicKey || !secretKey) {
      logger.debug('[FeedbackPlugin] Langfuse credentials not configured - feedback disabled');
      return;
    }

    try {
      this.langfuseClient = new Langfuse({
        publicKey,
        secretKey,
        baseUrl,
      });

      this.enabled = true;
      logger.info('[FeedbackPlugin] Initialized', { baseUrl });
    } catch (error) {
      logger.warn('[FeedbackPlugin] Failed to initialize Langfuse client', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  getName(): string {
    return 'feedback';
  }

  /**
   * Returns whether feedback is enabled (Langfuse is configured).
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  registerHandlers(server: { registerMessageHandler(type: string, handler: MessageHandler): void }): void {
    server.registerMessageHandler('message_feedback', this.handleFeedback.bind(this));
  }

  onClientConnect(session: ClientSession): void {
    // Emit feedback config to client
    session.socket.emit('config', {
      langfuseEnabled: this.enabled,
    });
  }

  /**
   * Handles incoming feedback from a client.
   */
  private async handleFeedback(_session: ClientSession, message: UseAIClientMessage): Promise<void> {
    if (!this.langfuseClient) {
      logger.debug('[FeedbackPlugin] Ignoring feedback - not enabled');
      return;
    }

    const feedbackMessage = message as FeedbackMessage;
    const { messageId, traceId, feedback } = feedbackMessage.data;

    if (feedback === null) {
      // Langfuse doesn't support deleting scores, so we just log and skip.
      logger.debug('[FeedbackPlugin] Feedback removed (not sent to Langfuse)', {
        messageId,
        traceId,
      });
      return;
    }

    try {
      // Use messageId + 'user-feedback' as idempotency key to allow updates
      const scoreId = `${messageId}-user-feedback`;

      this.langfuseClient.score({
        traceId,
        name: 'user-feedback',
        value: feedback === 'upvote' ? 1 : 0,
        id: scoreId,
      });

      logger.debug('[FeedbackPlugin] Score submitted to Langfuse', {
        traceId,
        scoreId,
        feedback,
        value: feedback === 'upvote' ? 1 : 0,
      });
    } catch (error) {
      logger.error('[FeedbackPlugin] Failed to submit score to Langfuse', {
        error: error instanceof Error ? error.message : 'Unknown error',
        traceId,
        messageId,
      });
    }
  }

  /**
   * Flushes any pending Langfuse events.
   * Should be called before server shutdown.
   */
  async close(): Promise<void> {
    if (this.langfuseClient) {
      await this.langfuseClient.flushAsync();
      logger.debug('[FeedbackPlugin] Flushed Langfuse events');
    }
  }
}
