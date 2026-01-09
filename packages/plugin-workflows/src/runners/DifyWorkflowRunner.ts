import type { WorkflowRunner, WorkflowInput, WorkflowResult, EventEmitter } from '../types';
import { EventType, type RunAgentInput } from '@meetsmore-oss/use-ai-core';
import { v4 as uuidv4 } from 'uuid';

/**
 * Configuration for DifyWorkflowRunner.
 */
export interface DifyWorkflowRunnerConfig {
  /**
   * Base URL of the Dify API (e.g., 'https://api.dify.ai/v1' or 'http://localhost:3001/v1').
   */
  apiBaseUrl: string;

  /**
   * Map of workflow names to Dify app API keys.
   * This allows you to use meaningful workflow names in your code while
   * keeping API keys in environment variables.
   *
   * @example
   * ```typescript
   * {
   *   workflows: {
   *     'greeting-workflow': process.env.DIFY_GREETING_WORKFLOW_KEY!,
   *     'pdf-processor': process.env.DIFY_PDF_PROCESSOR_KEY!,
   *   }
   * }
   * ```
   */
  workflows: Record<string, string>;
}

/**
 * Workflow runner for Dify AI workflows.
 *
 * Integrates with Dify (https://dify.ai) to execute workflows as headless operations.
 * Dify is designed for API-first workflow execution with proper variable handling.
 *
 * Features:
 * - Execute Dify workflows via API
 * - Support for streaming responses
 * - Pass workflow inputs as variables (properly supported unlike Flowise)
 * - Emit AG-UI events for text responses
 *
 * Note: This runner currently does not support tool calls back to the client.
 * Dify workflows execute independently and return text results.
 *
 * @example
 * ```typescript
 * const runner = new DifyWorkflowRunner({
 *   apiBaseUrl: 'http://localhost:3001/v1',
 *   workflows: {
 *     'greeting-workflow': process.env.DIFY_GREETING_WORKFLOW_KEY!,
 *     'pdf-processor': process.env.DIFY_PDF_PROCESSOR_KEY!,
 *   },
 * });
 *
 * // Use with WorkflowsPlugin
 * new WorkflowsPlugin({
 *   runners: new Map([
 *     ['dify', runner],
 *   ]),
 * });
 *
 * // Use meaningful workflow names (mapped to API keys on server):
 * const { trigger } = useAIWorkflow('dify', 'greeting-workflow');
 * await trigger({
 *   inputs: { username: 'Alice' },
 * });
 *
 * // Fallback: If workflow name not found in mapping, uses workflowId directly as API key:
 * const { trigger: directTrigger } = useAIWorkflow('dify', 'app-xxxxx');
 * ```
 */
export class DifyWorkflowRunner implements WorkflowRunner {
  private apiBaseUrl: string;
  private workflows: Record<string, string>;

  constructor(config: DifyWorkflowRunnerConfig) {
    this.apiBaseUrl = config.apiBaseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.workflows = config.workflows;
  }

  getName(): string {
    return 'dify';
  }

  async execute(input: WorkflowInput, events: EventEmitter): Promise<WorkflowResult> {
    const { session, runId, threadId, workflowId, inputs } = input;

    // Look up API key from workflow name, or use workflowId directly as API key (fallback)
    const apiKey = this.workflows[workflowId] || workflowId;

    try {
      // Emit RUN_STARTED
      const runAgentInput: RunAgentInput = {
        threadId,
        runId,
        messages: [],
        tools: input.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        state: inputs,
        context: [],
      };

      events.emit({
        type: EventType.RUN_STARTED,
        threadId,
        runId,
        input: runAgentInput,
        timestamp: Date.now(),
      });

      // Prepare request to Dify Workflow API
      const url = `${this.apiBaseUrl}/workflows/run`;
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };

      // Build request body
      // Dify expects: { inputs: {...}, response_mode: "streaming", user: "..." }
      const requestBody = {
        inputs: inputs, // All inputs passed directly as workflow variables
        response_mode: 'streaming', // Use streaming for better UX
        user: session.clientId, // Use client ID as user identifier
      };

      // Debug logging
      console.log('[DifyWorkflowRunner] Sending request to Dify:');
      console.log('  URL:', url);
      console.log('  Request body:', JSON.stringify(requestBody, null, 2));

      // Make request to Dify with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 100000); // 100 second timeout (Cloudflare limit)

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          throw new Error(`Request to Dify timed out after 100 seconds. Check that Dify is running at ${this.apiBaseUrl}`);
        }
        throw new Error(`Failed to connect to Dify at ${this.apiBaseUrl}: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`);
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Dify API error: ${response.status}`;

        // Parse error details if available
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorJson.error || errorText;
        } catch {
          errorMessage = errorText || errorMessage;
        }

        // Add helpful context for common errors
        if (response.status === 404) {
          errorMessage = `Workflow '${workflowId}' not found. Please create it in Dify first.`;
        } else if (response.status === 401) {
          errorMessage = `Dify API authentication failed. Check your API key.`;
        } else if (response.status === 500) {
          errorMessage = `Dify internal error: ${errorMessage}. Check workflow configuration and Dify logs.`;
        }

        throw new Error(errorMessage);
      }

      // Log successful response
      console.log(`Dify response status: ${response.status}, streaming: ${!!response.body}`);

      // Handle streaming response
      if (response.body) {
        await this.handleStreamingResponse(response.body, events, threadId, runId);
      } else {
        throw new Error('No response body received from Dify');
      }

      return {
        success: true,
        output: {},
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      events.emit({
        type: EventType.RUN_ERROR,
        message: errorMessage,
        timestamp: Date.now(),
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private async handleStreamingResponse(
    body: ReadableStream<Uint8Array>,
    events: EventEmitter,
    threadId: string,
    runId: string
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const messageId = uuidv4();
    let fullText = '';
    let hasReceivedData = false;
    let hasStartedMessage = false;

    try {
      // Add timeout for inactivity (100 seconds to match Cloudflare limit)
      const timeout = 100000;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const readWithTimeout = async () => {
        return new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error('Streaming timeout: No data received from Dify in 100 seconds'));
          }, timeout);

          reader.read().then((result) => {
            if (timeoutId) clearTimeout(timeoutId);
            resolve(result);
          }).catch((error) => {
            if (timeoutId) clearTimeout(timeoutId);
            reject(error);
          });
        });
      };

      while (true) {
        const { done, value } = await readWithTimeout();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim(); // Remove 'data:' (5 chars)

            try {
              const parsed = JSON.parse(data);

              // Dify SSE events: workflow_started, node_started, node_finished, workflow_finished, text_chunk, etc.
              if (parsed.event === 'text_chunk' || parsed.event === 'agent_message') {
                const text = parsed.data?.text || parsed.data?.chunk || '';
                if (text) {
                  if (!hasStartedMessage) {
                    // Emit TEXT_MESSAGE_START on first text chunk
                    events.emit({
                      type: EventType.TEXT_MESSAGE_START,
                      messageId,
                      role: 'assistant',
                      timestamp: Date.now(),
                    });
                    hasStartedMessage = true;
                  }

                  hasReceivedData = true;
                  fullText += text;

                  // Emit TEXT_MESSAGE_CONTENT for each chunk
                  events.emit({
                    type: EventType.TEXT_MESSAGE_CONTENT,
                    messageId,
                    delta: text,
                    timestamp: Date.now(),
                  });
                }
              } else if (parsed.event === 'workflow_finished') {
                // Workflow completed successfully
                console.log('[DifyWorkflowRunner] Workflow finished:', parsed.data);
              }
            } catch (e) {
              // Skip invalid JSON chunks
              continue;
            }
          }
        }
      }

      // Check if we received any data
      if (!hasReceivedData) {
        throw new Error('No response received from Dify workflow. Check that the workflow is properly configured with output nodes.');
      }

      // Emit TEXT_MESSAGE_END
      if (hasStartedMessage) {
        events.emit({
          type: EventType.TEXT_MESSAGE_END,
          messageId,
          timestamp: Date.now(),
        });
      }

      // Emit RUN_FINISHED
      events.emit({
        type: EventType.RUN_FINISHED,
        threadId,
        runId,
        result: fullText,
        timestamp: Date.now(),
      });
    } catch (error) {
      throw new Error(`Streaming error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      reader.releaseLock();
    }
  }
}
