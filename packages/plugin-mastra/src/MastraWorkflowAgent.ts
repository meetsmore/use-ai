import type { Mastra } from '@mastra/core';
import type { Agent, AgentInput, EventEmitter, AgentResult, ClientSession } from '@meetsmore-oss/use-ai-server';
import { logger } from '@meetsmore-oss/use-ai-server';
import { convertToolsToAISDKFormat } from './utils/toolConverter';
import { EventType } from '@meetsmore-oss/use-ai-core';
import { v4 as uuidv4 } from 'uuid';
import type { MastraWorkflowOutput } from './types';

/**
 * Configuration options for MastraWorkflowAgent
 */
export interface MastraWorkflowAgentConfig {
  /**
   * The ID of the workflow to execute.
   * This should match the workflow ID registered in Mastra.
   */
  workflowId: string;

  /**
   * The name for this agent.
   * This is the name displayed in the use-ai agent selector UI.
   */
  agentName: string;

  /**
   * Optional annotation/description for the agent.
   * Displayed in the use-ai agent selector UI to help users understand
   * the agent's capabilities or purpose.
   *
   * @example
   * ```typescript
   * { annotation: 'Executes support workflows' }
   * { annotation: 'Multi-step reasoning pipeline' }
   * ```
   */
  annotation?: string;
}

/**
 * Mastra workflow stream chunk types that we handle.
 * Based on the ChunkType from @mastra/core/stream/types.
 */
interface WorkflowStepOutputChunk {
  type: 'workflow-step-output';
  runId: string;
  from: string;
  payload: {
    output: string;
    runId: string;
    stepName: string;
  };
}

interface WorkflowFinishChunk {
  type: 'workflow-finish';
  runId: string;
  from: string;
  payload: {
    workflowStatus: string;
    metadata: Record<string, unknown>;
    output: {
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
    };
  };
}

interface WorkflowStepStartChunk {
  type: 'workflow-step-start';
  runId: string;
  from: string;
  payload: {
    stepName: string;
    id: string;
    stepCallId: string;
    status: string;
  };
}

interface WorkflowStepResultChunk {
  type: 'workflow-step-result';
  runId: string;
  from: string;
  payload: {
    stepName: string;
    id: string;
    stepCallId: string;
    status: string;
    output?: MastraWorkflowOutput;
  };
}

interface WorkflowStartChunk {
  type: 'workflow-start';
  runId: string;
  from: string;
  payload: {
    workflowId: string;
  };
}

/**
 * Custom chunk types for tool calls emitted via writer.custom() from workflow steps.
 * These are emitted when using agent.fullStream in the workflow step.
 * Data is nested in payload because that's how Mastra passes through custom chunk data.
 */
interface ToolCallStartChunk {
  type: 'tool-call-start';
  runId?: string;
  from?: string;
  payload: {
    toolCallId: string;
    toolName: string;
  };
}

interface ToolCallArgsChunk {
  type: 'tool-call-args';
  runId?: string;
  from?: string;
  payload: {
    toolCallId: string;
    delta: string;
  };
}

interface ToolCallEndChunk {
  type: 'tool-call-end';
  runId?: string;
  from?: string;
  payload: {
    toolCallId: string;
  };
}

type WorkflowStreamChunk =
  | WorkflowStartChunk
  | WorkflowStepStartChunk
  | WorkflowStepOutputChunk
  | WorkflowStepResultChunk
  | WorkflowFinishChunk
  | ToolCallStartChunk
  | ToolCallArgsChunk
  | ToolCallEndChunk
  | { type: string; [key: string]: unknown };

/**
 * Agent implementation that executes Mastra workflows as Use-AI agents.
 *
 * This agent integrates Mastra (https://mastra.ai) workflows with the use-ai server,
 * allowing you to use Mastra's workflow orchestration capabilities while maintaining
 * compatibility with use-ai's AG-UI protocol.
 *
 * **Important:** Workflow input/output types must conform to {@link MastraWorkflowInput}
 * and {@link MastraWorkflowOutput} defined in this package.
 *
 * **Streaming Support:**
 * This agent uses `stream()` to stream workflow execution. The workflow step
 * should pipe the agent's `textStream` to the step's `writer` for real-time streaming:
 *
 * ```typescript
 * const agentStep = createStep({
 *   execute: async ({ inputData, mastra, writer }) => {
 *     const agent = mastra?.getAgent('myAgent');
 *     const stream = await agent?.stream(inputData.messages);
 *     await stream!.textStream.pipeTo(writer!);
 *     return { finalAnswer: await stream!.text, ... };
 *   }
 * });
 * ```
 *
 * @example
 * ```typescript
 * import { UseAIServer, AISDKAgent } from '@meetsmore-oss/use-ai-server';
 * import { MastraWorkflowAgent } from '@meetsmore-oss/use-ai-plugin-mastra';
 * import { Mastra } from '@mastra/core';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * // Create Mastra instance with your workflows
 * const mastra = new Mastra({
 *   agents: { myAgent },
 *   workflows: { myWorkflow },
 * });
 *
 * const server = new UseAIServer({
 *   agents: {
 *     claude: new AISDKAgent({ model: anthropic('claude-3-5-sonnet-20241022') }),
 *     support: new MastraWorkflowAgent(mastra, { workflowId: 'supportWorkflow' }),
 *   },
 *   defaultAgent: 'claude',
 * });
 * ```
 */
export class MastraWorkflowAgent implements Agent {
  private mastra: Mastra;
  private workflowId: string;
  private agentName: string;
  private annotation?: string;

  constructor(mastra: Mastra, config: MastraWorkflowAgentConfig) {
    this.mastra = mastra;
    this.workflowId = config.workflowId;
    this.agentName = config.agentName;
    this.annotation = config.annotation;
  }

  getName(): string {
    return this.agentName;
  }

  getAnnotation(): string | undefined {
    return this.annotation;
  }

  async run(input: AgentInput, events: EventEmitter): Promise<AgentResult> {
    const { session, runId, messages, tools, systemPrompt, originalInput } = input;

    // Message ID for text messages (generated when first text chunk arrives)
    let messageId: string | null = null;
    let hasEmittedTextStart = false;
    let finalText = '';
    let workflowOutput: MastraWorkflowOutput | null = null;

    logger.info('MastraWorkflowAgent run() invoked', {
      runId,
      workflowId: this.workflowId,
      threadId: session.threadId,
      messageCount: messages.length,
      toolCount: tools.length,
      systemPromptPreview: systemPrompt?.slice(0, 60) ?? '',
    });

    // 1. Emit RUN_STARTED event
    events.emit({
      type: EventType.RUN_STARTED,
      threadId: session.threadId,
      runId,
      timestamp: Date.now(),
    });

    // 2. Emit MESSAGES_SNAPSHOT event
    events.emit({
      type: EventType.MESSAGES_SNAPSHOT,
      messages: originalInput.messages,
      timestamp: Date.now(),
    });

    try {
      // 3. Retrieve Mastra workflow
      logger.debug('MastraWorkflowAgent fetching workflow', { workflowId: this.workflowId });
      const workflow = this.mastra.getWorkflow(this.workflowId);
      if (!workflow) {
        throw new Error(`Workflow "${this.workflowId}" not found`);
      }
      logger.debug('MastraWorkflowAgent workflow retrieved successfully');

      // 4. Convert use-ai tools to AI SDK format
      const clientTools = convertToolsToAISDKFormat({
        tools,
        session: session as ClientSession,
      });
      logger.debug('MastraWorkflowAgent client tools converted', {
        providedTools: tools.map((t) => t.name),
        executableToolCount: Object.keys(clientTools).length,
      });

      // 5. Create workflow run and stream
      logger.debug('MastraWorkflowAgent creating workflow run instance');
      // Note: createRunAsync was renamed to createRun in @mastra/core 1.0.0-beta
      const workflowRun = await workflow.createRun();
      logger.debug('MastraWorkflowAgent workflow run instance created, starting stream');

      // Note: streamVNext was renamed to stream in @mastra/core 1.0.0-beta
      const stream = workflowRun.stream({
        inputData: {
          messages,
          systemPrompt,
          clientTools,
        },
      });

      // 6. Process stream chunks
      for await (const chunk of stream as AsyncIterable<WorkflowStreamChunk>) {
        logger.debug('MastraWorkflowAgent received chunk', { type: chunk.type });

        switch (chunk.type) {
          case 'workflow-start':
            logger.debug('MastraWorkflowAgent workflow started', {
              workflowId: (chunk as WorkflowStartChunk).payload.workflowId,
            });
            break;

          case 'workflow-step-start':
            logger.debug('MastraWorkflowAgent step started', {
              stepName: (chunk as WorkflowStepStartChunk).payload.stepName,
            });
            break;

          case 'workflow-step-output': {
            // Text delta from agent streaming via writer.pipeTo()
            const outputChunk = chunk as WorkflowStepOutputChunk;
            const textDelta = outputChunk.payload.output;

            if (typeof textDelta === 'string' && textDelta.length > 0) {
              // Emit TEXT_MESSAGE_START on first text chunk
              if (!hasEmittedTextStart) {
                messageId = uuidv4();
                events.emit({
                  type: EventType.TEXT_MESSAGE_START,
                  messageId,
                  role: 'assistant',
                  timestamp: Date.now(),
                });
                hasEmittedTextStart = true;
                logger.debug('MastraWorkflowAgent TEXT_MESSAGE_START emitted', { messageId });
              }

              // Emit TEXT_MESSAGE_CONTENT for each text delta
              // messageId is guaranteed to be set because we set it in the if block above
              events.emit({
                type: EventType.TEXT_MESSAGE_CONTENT,
                messageId: messageId!,
                delta: textDelta,
                timestamp: Date.now(),
              });
              finalText += textDelta;
              logger.debug('MastraWorkflowAgent TEXT_MESSAGE_CONTENT emitted', {
                messageId,
                deltaLength: textDelta.length,
              });
            }
            break;
          }

          case 'workflow-step-result': {
            // Capture the workflow output from the step result
            const resultChunk = chunk as WorkflowStepResultChunk;
            if (resultChunk.payload.output) {
              workflowOutput = resultChunk.payload.output;
              logger.debug('MastraWorkflowAgent step result received', {
                stepName: resultChunk.payload.stepName,
                status: resultChunk.payload.status,
              });
            }
            break;
          }

          case 'tool-call-start': {
            // Custom chunk from workflow step via writer.custom()
            // Data is nested in payload
            const toolCallChunk = chunk as ToolCallStartChunk;
            events.emit({
              type: EventType.TOOL_CALL_START,
              toolCallId: toolCallChunk.payload.toolCallId,
              toolCallName: toolCallChunk.payload.toolName,
              parentMessageId: messageId ?? uuidv4(),
              timestamp: Date.now(),
            });
            logger.debug('MastraWorkflowAgent TOOL_CALL_START emitted', {
              toolCallId: toolCallChunk.payload.toolCallId,
              toolName: toolCallChunk.payload.toolName,
            });
            break;
          }

          case 'tool-call-args': {
            // Custom chunk from workflow step via writer.custom()
            // Data is nested in payload
            const argsChunk = chunk as ToolCallArgsChunk;
            events.emit({
              type: EventType.TOOL_CALL_ARGS,
              toolCallId: argsChunk.payload.toolCallId,
              delta: argsChunk.payload.delta,
              timestamp: Date.now(),
            });
            logger.debug('MastraWorkflowAgent TOOL_CALL_ARGS emitted', {
              toolCallId: argsChunk.payload.toolCallId,
              deltaLength: argsChunk.payload.delta?.length,
            });
            break;
          }

          case 'tool-call-end': {
            // Custom chunk from workflow step via writer.custom()
            // Data is nested in payload
            const endChunk = chunk as ToolCallEndChunk;
            events.emit({
              type: EventType.TOOL_CALL_END,
              toolCallId: endChunk.payload.toolCallId,
              timestamp: Date.now(),
            });
            logger.debug('MastraWorkflowAgent TOOL_CALL_END emitted', {
              toolCallId: endChunk.payload.toolCallId,
            });
            break;
          }

          case 'workflow-finish': {
            const finishChunk = chunk as WorkflowFinishChunk;
            logger.info('MastraWorkflowAgent workflow finished', {
              status: finishChunk.payload.workflowStatus,
              usage: finishChunk.payload.output?.usage,
            });

            // End text message if we started one
            if (hasEmittedTextStart && messageId) {
              events.emit({
                type: EventType.TEXT_MESSAGE_END,
                messageId,
                timestamp: Date.now(),
              });
              logger.debug('MastraWorkflowAgent TEXT_MESSAGE_END emitted', { messageId });
            }
            break;
          }

          default:
            // Log unknown chunk types for debugging
            logger.debug('MastraWorkflowAgent unknown chunk type', { type: chunk.type });
            break;
        }
      }

      // 7. Get final result
      const result = await stream.result;
      logger.info('MastraWorkflowAgent stream completed', { status: result?.status });

      if (result?.status !== 'success') {
        throw new Error(`Workflow failed: ${JSON.stringify(result)}`);
      }

      // If no text was streamed but we have workflow output, emit it as a single message
      if (!hasEmittedTextStart && workflowOutput?.finalAnswer) {
        messageId = uuidv4();
        events.emit({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: 'assistant',
          timestamp: Date.now(),
        });
        events.emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: workflowOutput.finalAnswer,
          timestamp: Date.now(),
        });
        events.emit({
          type: EventType.TEXT_MESSAGE_END,
          messageId,
          timestamp: Date.now(),
        });
        finalText = workflowOutput.finalAnswer;
        logger.debug('MastraWorkflowAgent fallback text message emitted', {
          messageId,
          textLength: finalText.length,
        });
      }

      // 8. Emit RUN_FINISHED event
      events.emit({
        type: EventType.RUN_FINISHED,
        threadId: session.threadId,
        runId,
        timestamp: Date.now(),
      });
      logger.debug('MastraWorkflowAgent RUN_FINISHED emitted', { runId });

      // 9. Update conversation history
      if (workflowOutput?.conversationHistory) {
        session.conversationHistory.push(...workflowOutput.conversationHistory);
      }

      return {
        success: true,
        conversationHistory: session.conversationHistory,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('MastraWorkflowAgent error caught in run()', { error });

      // End text message if we started one before the error
      if (hasEmittedTextStart && messageId) {
        events.emit({
          type: EventType.TEXT_MESSAGE_END,
          messageId,
          timestamp: Date.now(),
        });
      }

      events.emit({
        type: EventType.RUN_ERROR,
        message: errorMessage,
        timestamp: Date.now(),
      });

      return {
        success: false,
        error: errorMessage,
        conversationHistory: messages,
      };
    }
  }
}
