#!/usr/bin/env bun
import { UseAIServer, AISDKAgent, logger } from '@meetsmore-oss/use-ai-server';
import type { Agent, McpEndpointConfig } from '@meetsmore-oss/use-ai-server';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { WorkflowsPlugin, DifyWorkflowRunner } from '@meetsmore-oss/use-ai-plugin-workflows';
import type { WorkflowRunner } from '@meetsmore-oss/use-ai-plugin-workflows';

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
    agents.claude = new AISDKAgent({ model: anthropic(model), name: 'Claude' });
    enabledAgents.push(`claude (${model})`);
  }

  // Check for OpenAI API key
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (openaiApiKey) {
    const model = process.env.OPENAI_MODEL || 'gpt-4-turbo';
    const openai = createOpenAI({ apiKey: openaiApiKey });
    agents.gpt = new AISDKAgent({ model: openai(model), name: 'ChatGPT' });
    enabledAgents.push(`gpt (${model})`);
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

logger.info('Starting UseAI server', { logFormat });

// Create agents and workflow runners
const { agents, defaultAgent } = createAgents();
const workflowRunners = createWorkflowRunners();
const mcpEndpoints = createMcpEndpoints();

// Build plugins array
const plugins = [];
if (workflowRunners.size > 0) {
  plugins.push(new WorkflowsPlugin({ runners: workflowRunners }));
}

const server = new UseAIServer({
  port,
  agents,
  defaultAgent,
  rateLimitMaxRequests,
  rateLimitWindowMs,
  plugins: plugins.length > 0 ? plugins : undefined,
  mcpEndpoints: mcpEndpoints.length > 0 ? mcpEndpoints : undefined,
  maxHttpBufferSize,
  cors: corsOrigin
    ? {
        origin: corsOrigin === '*' ? true : corsOrigin,
        methods: ['GET', 'POST'],
        credentials: true,
      }
    : {
        origin: true, // Allow all origins by default for local development
        methods: ['GET', 'POST'],
        credentials: true,
      },
  idleTimeout: 30, // Must be greater than pingInterval (25s)
});

// Initialize MCP endpoints
if (mcpEndpoints.length > 0) {
  await server.initialize();
}

// Server will log when it's actually listening via the callback in the constructor
if (logFormat === 'pretty') {
  console.log(`✓ UseAI server is running on port ${port}`);
  console.log(`  WebSocket URL: ws://localhost:${port}`);
  console.log(`  Log format: ${logFormat} (set LOG_FORMAT=json for structured logs)`);
  console.log('  Press Ctrl+C to stop');
}

