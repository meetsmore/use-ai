import type { UseAIServerPlugin, MessageHandler, ClientSession } from '@meetsmore-oss/use-ai-server';
import { logger } from '@meetsmore-oss/use-ai-server';
import type { UseAIClientMessage, RunWorkflowMessage, ToolDefinition } from '@meetsmore-oss/use-ai-core';
import { EventType } from '@meetsmore-oss/use-ai-core';
import type { WorkflowRunner, EventEmitter } from './types';

/**
 * Configuration for WorkflowsPlugin.
 */
export interface WorkflowsPluginConfig {
  /**
   * Map of workflow runner names to runner instances.
   *
   * @example
   * ```typescript
   * {
   *   runners: new Map([
   *     ['dify', new DifyWorkflowRunner({ apiBaseUrl: 'http://localhost:3001/v1' })],
   *   ])
   * }
   * ```
   */
  runners: Map<string, WorkflowRunner>;
}

/**
 * Plugin for workflow execution functionality.
 *
 * This plugin adds support for headless workflow execution to UseAIServer.
 * Workflows are:
 * - Stateless (no conversation history)
 * - Triggered programmatically (not by user chat)
 * - Single-run operations
 * - Can still call frontend tools via AG-UI protocol
 *
 * @example
 * ```typescript
 * import { UseAIServer, AISDKAgent } from '@meetsmore-oss/use-ai-server';
 * import { WorkflowsPlugin } from '@meetsmore-oss/use-ai-plugin-workflows';
 * import { DifyWorkflowRunner } from '@meetsmore-oss/use-ai-plugin-workflows'; // Dify workflow runner
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * const model = anthropic('claude-3-5-sonnet-20241022');
 *
 * const server = new UseAIServer({
 *   agents: {
 *     claude: new AISDKAgent({ model }),
 *   },
 *   defaultAgent: 'claude',
 *   plugins: [
 *     new WorkflowsPlugin({
 *       runners: new Map([
 *         ['dify', new DifyWorkflowRunner({ apiBaseUrl: 'http://localhost:3001/v1' })],
 *       ]),
 *     }),
 *   ],
 * });
 * ```
 */
export class WorkflowsPlugin implements UseAIServerPlugin {
  private runners: Map<string, WorkflowRunner>;

  constructor(config: WorkflowsPluginConfig) {
    this.runners = config.runners;
  }

  getName(): string {
    return 'workflows';
  }

  registerHandlers(server: { registerMessageHandler(type: string, handler: MessageHandler): void }): void {
    server.registerMessageHandler('run_workflow', this.handleRunWorkflow.bind(this));
  }

  private async handleRunWorkflow(session: ClientSession, message: UseAIClientMessage): Promise<void> {
    const workflowMessage = message as RunWorkflowMessage;
    const { runner: runnerName, workflowId, inputs, tools, runId, threadId, forwardedProps } = workflowMessage.data;

    // Extract MCP headers from forwardedProps (AG-UI extension point)
    const mcpHeaders = forwardedProps?.mcpHeaders as import('@meetsmore-oss/use-ai-core').McpHeadersMap | undefined;

    logger.info('Running workflow', {
      runner: runnerName,
      workflowId,
      toolCount: tools?.length || 0,
    });

    // Get the requested workflow runner
    const runner = this.runners.get(runnerName);
    if (!runner) {
      const availableRunners = Array.from(this.runners.keys()).join(', ');
      logger.error('Workflow runner not found', {
        requestedRunner: runnerName,
        availableRunners: Array.from(this.runners.keys()),
      });
      session.socket.emit('event', {
        type: EventType.RUN_ERROR,
        message: `Workflow runner "${runnerName}" not found. Available runners: ${availableRunners}`,
        timestamp: Date.now(),
      });
      return;
    }

    // Update session with workflow tools
    session.threadId = threadId;
    session.currentRunId = runId;
    session.tools = (tools || []).map((t: ToolDefinition) => ({
      ...t,
      parameters: t.parameters || { type: 'object', properties: {}, required: [] },
    })) as ToolDefinition[];
    session.state = inputs;

    // Store MCP headers for this workflow execution (will be cleared after completion)
    session.currentMcpHeaders = mcpHeaders;

    // Create event emitter for workflow runner
    const eventEmitter: EventEmitter = {
      emit: (event) => {
        session.socket.emit('event', event);
      },
    };

    // Execute workflow
    try {
      const result = await runner.execute(
        {
          session,
          runId,
          threadId,
          workflowId,
          inputs,
          tools: session.tools,
        },
        eventEmitter
      );

      if (result.success) {
        logger.info('Workflow completed successfully', {
          runner: runnerName,
          workflowId,
        });
      } else {
        logger.error('Workflow failed', {
          runner: runnerName,
          workflowId,
          error: result.error,
        });
      }
    } finally {
      // Clear MCP headers after workflow completes (success or failure)
      delete session.currentMcpHeaders;
    }
  }
}
