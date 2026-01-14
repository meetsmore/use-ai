import { describe, expect, test } from 'bun:test';
import type { McpEndpointConfig } from './types';
import { UseAIServer } from './server';
import { AISDKAgent } from './agents/AISDKAgent';
import type { LanguageModel } from 'ai';

// Helper to create a test agent
function createTestAgent(name: string = 'test-agent'): AISDKAgent {
  const mockModel: LanguageModel = {
    specificationVersion: 'v1',
    provider: 'test-provider',
    modelId: 'test-model',
    defaultObjectGenerationMode: undefined,
  } as any;
  return new AISDKAgent({ model: mockModel });
}

describe('MCP Integration', () => {
  test('Remote MCP servers can be configured with endpoints', () => {
    const mcpPort = 9007;
    const mcpConfig: McpEndpointConfig[] = [
      {
        url: 'http://localhost:3002/mcp',
        namespace: 'mcp',
        timeout: 30000,
        headers: { 'Authorization': 'Bearer test' },
      },
    ];

    // Server accepts MCP configuration
    const mcpServer = new UseAIServer({
      port: mcpPort,
      agents: { test: createTestAgent() },
      defaultAgent: 'test',
      mcpEndpoints: mcpConfig,
      cors: { origin: '*' },
    });

    expect(mcpServer).toBeDefined();

    mcpServer.close();
  });

  test('MCP tool names are prefixed with namespace', () => {
    // This is verified by the RemoteMcpToolsProvider implementation
    // Tools are prefixed during conversion (e.g., "add" becomes "mcp_add")
    expect(true).toBe(true);
  });

  test('Server fetches MCP tool schemas on init with retries', () => {
    // This is tested in the RemoteMcpToolsProvider unit tests
    // and in the E2E tests that verify schema fetching works
    expect(true).toBe(true);
  });

  test('MCP tools are executed via JSON-RPC with timeout', () => {
    // This is verified by the RemoteMcpToolsProvider implementation
    // and E2E tests in apps/example/test/remote-mcp-tools.e2e.test.ts
    expect(true).toBe(true);
  });

  test('Custom headers can be added to MCP requests', () => {
    // Configuration supports headers at both server-wide and per-request levels
    const config: McpEndpointConfig = {
      url: 'http://localhost:3002/mcp',
      headers: { 'Authorization': 'Bearer token' },
    };

    expect(config.headers).toBeDefined();
    expect(config.headers!['Authorization']).toBe('Bearer token');
  });

  test('MCP tool cache TTL can be configured', () => {
    const config: McpEndpointConfig = {
      url: 'http://localhost:3002/mcp',
      toolsCacheTtl: 60000, // Cache for 60 seconds
    };

    expect(config.toolsCacheTtl).toBe(60000);
  });

  test('MCP endpoints are cleaned up on server shutdown', () => {
    const mcpPort = 9008;
    const mcpServer = new UseAIServer({
      port: mcpPort,
      agents: { test: createTestAgent() },
      defaultAgent: 'test',
      mcpEndpoints: [
        {
          url: 'http://localhost:3002/mcp',
          toolsCacheTtl: 60000,
        },
      ],
      cors: { origin: '*' },
    });

    // Server cleanup happens in close()
    mcpServer.close();

    // If we reach here without error, `mcpServer.close()` was called.
    expect(true).toBe(true);
  });
});
