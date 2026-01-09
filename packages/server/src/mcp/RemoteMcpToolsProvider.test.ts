import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { RemoteMcpToolsProvider } from './RemoteMcpToolsProvider';

describe('RemoteMcpToolsProvider', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            result: {
              tools: [
                {
                  name: 'test-tool',
                  description: 'A test tool',
                  inputSchema: {
                    type: 'object',
                    properties: { input: { type: 'string' } },
                    required: ['input'],
                  },
                },
              ],
            },
          }),
      } as Response)
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('fetchToolsWithHeaders', () => {
    test('sends auth headers with tools/list request', async () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
      });

      await provider.fetchToolsWithHeaders({ Authorization: 'Bearer token123' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://mcp.test/rpc');
      expect(options.headers).toMatchObject({
        Authorization: 'Bearer token123',
      });
    });

    test('merges server-wide and per-user headers', async () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
        headers: { 'X-Server-Key': 'server-secret' },
      });

      await provider.fetchToolsWithHeaders({ Authorization: 'Bearer user-token' });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers).toMatchObject({
        'X-Server-Key': 'server-secret',
        Authorization: 'Bearer user-token',
      });
    });

    test('per-user headers override server-wide headers', async () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
        headers: { Authorization: 'Bearer server-token' },
      });

      await provider.fetchToolsWithHeaders({ Authorization: 'Bearer user-token' });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers.Authorization).toBe('Bearer user-token');
    });

    test('works without auth headers', async () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
      });

      const tools = await provider.fetchToolsWithHeaders();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('test-tool');
    });

    test('converts MCP tool schema to ToolDefinition format', async () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
      });

      const tools = await provider.fetchToolsWithHeaders();

      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        name: 'test-tool',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: { input: { type: 'string' } },
          required: ['input'],
        },
        _remote: {
          provider,
          originalName: 'test-tool',
        },
      });
    });

    test('applies namespace prefix to tool names', async () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
        namespace: 'backend',
      });

      const tools = await provider.fetchToolsWithHeaders();

      expect(tools[0].name).toBe('backend_test-tool');
      expect(tools[0]._remote.originalName).toBe('test-tool');
    });

    test('throws on HTTP error', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        } as Response)
      );

      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
      });

      await expect(provider.fetchToolsWithHeaders()).rejects.toThrow(
        'HTTP 500: Internal Server Error'
      );
    });

    test('throws on MCP error response', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              error: { message: 'Tool listing failed' },
            }),
        } as Response)
      );

      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
      });

      await expect(provider.fetchToolsWithHeaders()).rejects.toThrow(
        'MCP error: Tool listing failed'
      );
    });

    test('sends correct JSON-RPC request body', async () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
      });

      await provider.fetchToolsWithHeaders();

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.method).toBe('tools/list');
      expect(body.id).toBeDefined();
    });
  });

  describe('getToolsCacheTtl', () => {
    test('returns 0 by default', () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
      });

      expect(provider.getToolsCacheTtl()).toBe(0);
    });

    test('returns configured TTL', () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
        toolsCacheTtl: 60000,
      });

      expect(provider.getToolsCacheTtl()).toBe(60000);
    });
  });

  describe('initialize', () => {
    test('does not fetch tools eagerly', async () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
      });

      await provider.initialize();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
