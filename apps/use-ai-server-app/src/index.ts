#!/usr/bin/env bun
import { UseAIServer, AISDKAgent, logger, defineServerTool, createMockReasoningModel } from '@meetsmore-oss/use-ai-server';
import type { Agent, McpEndpointConfig, ServerToolConfig, UseAIServerPlugin, BeforeRunAgentResult, AgentInput } from '@meetsmore-oss/use-ai-server';
import type { UseAIForwardedProps } from '@meetsmore-oss/use-ai-core';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { WorkflowsPlugin, DifyWorkflowRunner } from '@meetsmore-oss/use-ai-plugin-workflows';
import type { WorkflowRunner } from '@meetsmore-oss/use-ai-plugin-workflows';
import { z } from 'zod';

const port = Number(process.env.PORT) || 8081;
const rateLimitMaxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 0;
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
const logFormat = process.env.LOG_FORMAT || 'pretty';
// Max HTTP buffer size for file uploads (default 20MB)
const maxHttpBufferSize = process.env.MAX_HTTP_BUFFER_SIZE
  ? Number(process.env.MAX_HTTP_BUFFER_SIZE)
  : undefined;
// CORS origin for Socket.IO (e.g., '*' for local dev, 'https://example.com' for production)
const corsOrigin = process.env.CORS_ORIGIN;
// Runtime adapter: 'auto' (default), 'bun', or 'node'
const runtime = (process.env.RUNTIME as 'auto' | 'bun' | 'node') || 'auto';

/**
 * Create agents based on available API keys.
 * Returns a map of agent names to agent instances.
 */
function createAgents(): { agents: Record<string, Agent>; defaultAgent: string } {
  const agents: Record<string, Agent> = {};
  const enabledAgents: string[] = [];

  // Check for Anthropic API key
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicApiKey) {
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
    const anthropic = createAnthropic({ apiKey: anthropicApiKey });
    // Temperature can be set via env var (useful for E2E tests to reduce flakiness)
    const temperature = process.env.AI_TEMPERATURE ? Number(process.env.AI_TEMPERATURE) : undefined;
    // Extended thinking configuration (opt-in via env var)
    const thinkingBudget = process.env.THINKING_BUDGET_TOKENS ? Number(process.env.THINKING_BUDGET_TOKENS) : undefined;
    const reasoning = thinkingBudget ? { anthropic: { budgetTokens: thinkingBudget } } : undefined;

    agents.claude = new AISDKAgent({ model: anthropic(model), name: 'Claude', temperature, reasoning });
    enabledAgents.push(`claude (${model}${temperature !== undefined ? `, temp=${temperature}` : ''}${reasoning ? `, thinking=${thinkingBudget}` : ''})`);
  }

  // Check for OpenAI API key
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (openaiApiKey) {
    const model = process.env.OPENAI_MODEL || 'gpt-4-turbo';
    const openai = createOpenAI({ apiKey: openaiApiKey });
    agents.gpt = new AISDKAgent({ model: openai(model), name: 'ChatGPT' });
    enabledAgents.push(`gpt (${model})`);
  }

  // Mock agent for UI development (no API key needed)
  if (process.env.ENABLE_MOCK_AGENT) {
    agents.mock = new AISDKAgent({
      model: createMockReasoningModel(),
      name: 'Mock (Reasoning)',
      annotation: 'Mock model with reasoning, tool calls, and multi-step flows for UI testing',
      reasoning: { anthropic: { budgetTokens: 10000 } },
    });
    enabledAgents.push('mock (reasoning UI testing)');
  }

  // Require at least one agent
  if (Object.keys(agents).length === 0) {
    console.error('Error: At least one AI provider API key is required');
    console.error('Please set one of the following:');
    console.error('  - ANTHROPIC_API_KEY (for Claude)');
    console.error('  - OPENAI_API_KEY (for GPT)');
    process.exit(1);
  }

  // Default to Claude if available, otherwise use the first available agent
  const defaultAgent = agents.claude ? 'claude' : Object.keys(agents)[0];

  if (logFormat === 'pretty') {
    console.log(`✓ Enabled agents: ${enabledAgents.join(', ')}`);
    console.log(`  Default agent: ${defaultAgent}`);
  } else {
    logger.info('Agents configured', { enabledAgents, defaultAgent });
  }

  return { agents, defaultAgent };
}

/**
 * Create workflow runners based on available configuration.
 * Returns a map of runner names to runner instances.
 */
function createWorkflowRunners(): Map<string, WorkflowRunner> {
  const runners = new Map<string, WorkflowRunner>();
  const enabledRunners: string[] = [];

  // Check for Dify configuration
  const difyUrl = process.env.DIFY_API_URL;
  if (difyUrl) {
    // Build workflows mapping from environment variables
    // Convention: DIFY_<WORKFLOW_NAME>_KEY maps to workflow name
    const workflows: Record<string, string> = {};

    // Example: DIFY_GREETING_WORKFLOW_KEY -> 'greeting-workflow'
    // Example: DIFY_PDF_PROCESSOR_KEY -> 'pdf-processor'
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('DIFY_') && key.endsWith('_KEY')) {
        const workflowName = key
          .slice(5, -4) // Remove 'DIFY_' prefix and '_KEY' suffix
          .toLowerCase()
          .replace(/_/g, '-'); // Convert underscores to hyphens
        workflows[workflowName] = process.env[key]!;
      }
    });

    runners.set(
      'dify',
      new DifyWorkflowRunner({
        apiBaseUrl: difyUrl,
        workflows,
      })
    );

    const workflowNames = Object.keys(workflows).join(', ');
    enabledRunners.push(
      `dify (${difyUrl}${workflowNames ? `, workflows: ${workflowNames}` : ''})`
    );
  }

  if (logFormat === 'pretty' && enabledRunners.length > 0) {
    console.log(`✓ Enabled workflow runners: ${enabledRunners.join(', ')}`);
  } else if (enabledRunners.length > 0) {
    logger.info('Workflow runners configured', { enabledRunners });
  }

  return runners;
}

/**
 * Create MCP endpoint configurations from environment variables.
 * Returns an array of MCP endpoint configs.
 */
function createMcpEndpoints(): McpEndpointConfig[] {
  const endpoints: McpEndpointConfig[] = [];

  // Collect all MCP_ENDPOINT_*_URL environment variables
  Object.keys(process.env).forEach((key) => {
    if (key.startsWith('MCP_ENDPOINT_') && key.endsWith('_URL')) {
      const url = process.env[key];
      if (!url) return;

      // Extract the name (e.g., 'MYNAME' from 'MCP_ENDPOINT_MYNAME_URL')
      const name = key.slice(13, -4); // Remove 'MCP_ENDPOINT_' prefix and '_URL' suffix

      // Look for corresponding namespace and timeout
      const namespaceKey = `MCP_ENDPOINT_${name}_NAMESPACE`;
      const timeoutKey = `MCP_ENDPOINT_${name}_TIMEOUT`;

      const namespace = process.env[namespaceKey] || name.toLowerCase().replace(/_/g, '-');
      const timeout = Number(process.env[timeoutKey]) || 30000;

      endpoints.push({
        url,
        namespace,
        timeout,
      });

      if (logFormat === 'pretty') {
        console.log(`✓ MCP endpoint configured: ${url} (namespace: ${namespace})`);
      } else {
        logger.info('MCP endpoint configured', { url, namespace, timeout });
      }
    }
  });

  return endpoints;
}

/**
 * Create example server tools for testing/demo purposes.
 * Only enabled when ENABLE_EXAMPLE_SERVER_TOOLS is set.
 */
function createServerTools(): Record<string, ServerToolConfig> | undefined {
  if (!process.env.ENABLE_EXAMPLE_SERVER_TOOLS) {
    return undefined;
  }

  const tools: Record<string, ServerToolConfig> = {
    getServerTime: defineServerTool(
      'Get the current server time as an ISO 8601 timestamp',
      async () => new Date().toISOString(),
      { annotations: { readOnlyHint: true } }
    ),
    addNumbers: defineServerTool(
      'Add two numbers together and return the result',
      z.object({
        a: z.number().describe('First number'),
        b: z.number().describe('Second number'),
      }),
      async ({ a, b }) => ({ result: a + b }),
      { annotations: { readOnlyHint: true } }
    ),
    serverTransfer: defineServerTool(
      'Transfer money between accounts on the server side. Transfers over $1000 require user approval via ctx.requestApproval().',
      z.object({
        to: z.string().describe('Recipient account name'),
        amount: z.number().describe('Amount to transfer'),
      }),
      async ({ to, amount }, ctx) => {
        if (amount > 1000) {
          const { approved, reason } = await ctx.requestApproval({
            message: `[Server Tool] Transfer $${amount} to "${to}"? This exceeds the $1,000 threshold.`,
            metadata: { amount, to, source: 'server' },
          });
          if (!approved) {
            return { error: 'User rejected the transfer', reason };
          }
        }
        return {
          success: true,
          message: `Server transferred $${amount} to ${to}`,
          amount,
          to,
        };
      }
    ),
  };

  if (logFormat === 'pretty') {
    console.log(`✓ Example server tools enabled: ${Object.keys(tools).join(', ')}`);
  } else {
    logger.info('Example server tools enabled', { tools: Object.keys(tools) });
  }

  return tools;
}

/**
 * Example plugin demonstrating the beforeRunAgent hook.
 * Rejects any run where forwardedProps.token contains "invalid".
 */
class TokenValidationPlugin implements UseAIServerPlugin {
  getName(): string {
    return 'token-validation';
  }

  registerHandlers(): void {
    // No custom message handlers needed
  }

  async beforeRunAgent(input: AgentInput): Promise<BeforeRunAgentResult | void> {
    const forwardedProps = input.originalInput.forwardedProps as UseAIForwardedProps | undefined;
    const token = forwardedProps?.token;

    if (token && token.includes('invalid')) {
      logger.info('[TokenValidationPlugin] Rejecting run — invalid token', {
        clientId: input.session.clientId,
        token,
      });
      return { abort: true, message: 'Authentication failed: invalid token. (Demo: toggle off "Simulate Failure" to allow the run.)' };
    }
  }
}

logger.info('Starting UseAI server', { logFormat });

(async () => {
  try {
    // Create agents and workflow runners
    const { agents, defaultAgent } = createAgents();
    const workflowRunners = createWorkflowRunners();
    const mcpEndpoints = createMcpEndpoints();
    const serverTools = createServerTools();

    // Build plugins array
    const plugins: UseAIServerPlugin[] = [new TokenValidationPlugin()];
    if (workflowRunners.size > 0) {
      plugins.push(new WorkflowsPlugin({ runners: workflowRunners }));
    }

    const server = new UseAIServer({
      port,
      agents,
      defaultAgent,
      rateLimitMaxRequests,
      rateLimitWindowMs,
      plugins,
      mcpEndpoints: mcpEndpoints.length > 0 ? mcpEndpoints : undefined,
      tools: serverTools,
      maxHttpBufferSize,
      cors: corsOrigin
        ? {
            origin: corsOrigin === '*' ? true : corsOrigin,
            methods: ['GET', 'POST'],
            credentials: true,
          }
        : undefined,
      runtime,
    });

    // Initialize MCP endpoints
    if (mcpEndpoints.length > 0) {
      await server.initialize();
    }

    // Server will log when it's actually listening via the callback in the constructor
    if (logFormat === 'pretty') {
      console.log(`✓ UseAI server is running on port ${port}`);
      console.log(`  WebSocket URL: ws://localhost:${port}`);
      console.log(`  Runtime: ${runtime} (set RUNTIME=bun or RUNTIME=node to change)`);
      console.log(`  Log format: ${logFormat} (set LOG_FORMAT=json for structured logs)`);
      console.log('  Press Ctrl+C to stop');
    }
  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
})();
