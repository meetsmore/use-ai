import { Langfuse } from 'langfuse';
import type { UseAIServerPlugin, MessageHandler } from './types';
import type { ClientSession } from '../agents/types';
import type { UseAIClientMessage, FeedbackMessage } from '@meetsmore-oss/use-ai-core';
import { logger } from '../logger';
import { langfuse } from '../instrumentation';

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
 *   agents: { claude: new AISDKAgent({ hooks: { loadConfig: () => ({ model }) } }) },
 *   defaultAgent: 'claude',
 *   plugins: [
 *     new FeedbackPlugin(),
 *     // Or with explicit client:
 *     // new FeedbackPlugin(myLangfuseClient),
 *   ],
 * });
 * ```
 */
export class FeedbackPlugin implements UseAIServerPlugin {
  private langfuseClient: Langfuse | null = null;

  constructor(client: Langfuse | undefined = langfuse.client) {
    if (!client) {
      logger.debug('[FeedbackPlugin] Langfuse not enabled - feedback disabled');
      return
    }

    this.langfuseClient = client
    logger.info('[FeedbackPlugin] Initialized', { baseUrl: client.baseUrl });
  }

  getName(): string {
    return 'feedback';
  }

  /**
   * Returns whether feedback is enabled (Langfuse is configured).
   */
  isEnabled(): boolean {
    return !!this.langfuseClient;
  }

  registerHandlers(server: { registerMessageHandler(type: string, handler: MessageHandler): void }): void {
    server.registerMessageHandler('message_feedback', this.handleFeedback.bind(this));
  }

  onClientConnect(session: ClientSession): void {
    // Emit feedback config to client
    session.socket.emit('config', {
      langfuseEnabled: this.isEnabled(),
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
