import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { RemoteMcpToolsProvider } from './RemoteMcpToolsProvider';

describe('RemoteMcpToolsProvider', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock(() =>
      Promise.resolve(
        Response.json({
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
        })
      )
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

    test('server-wide headers cannot be overridden by per-user headers, regardless of case', async () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
        headers: { Authorization: 'Bearer server-token' },
      });

      await provider.fetchToolsWithHeaders({ authorization: 'Bearer user-token' });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers.Authorization).toBe('Bearer server-token');
      expect(options.headers.authorization).toBeUndefined();
    });

    test('drops per-user headers that are not allowed', async () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
      });

      await provider.fetchToolsWithHeaders({
        authorization: 'Bearer user-token',
        'X-Tenant-Id': 'other-tenant',
        Cookie: 'session=abc',
        'Content-Type': 'text/plain',
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        authorization: 'Bearer user-token',
      });
    });

    test('allows per-user headers listed in allowedClientHeaders', async () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
        allowedClientHeaders: ['x-tenant-id'],
      });

      await provider.fetchToolsWithHeaders({
        Authorization: 'Bearer user-token',
        'X-Tenant-Id': 'tenant-a',
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['X-Tenant-Id']).toBe('tenant-a');
      expect(options.headers.Authorization).toBeUndefined();
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
        Promise.resolve(new Response(null, { status: 500, statusText: 'Internal Server Error' }))
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
        Promise.resolve(Response.json({ error: { message: 'Tool listing failed' } }))
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

  describe('executeTool', () => {
    test('sends matching per-user headers, with server-wide headers taking precedence', async () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
        headers: { 'X-Tenant-Id': 'pinned-tenant' },
        allowedClientHeaders: ['Authorization', 'X-Tenant-Id'],
      });

      await provider.executeTool('test-tool', {}, {
        'http://mcp.test/*': {
          headers: { Authorization: 'Bearer user-token', 'x-tenant-id': 'other-tenant', 'X-User-Id': 'admin' },
        },
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer user-token',
        'X-Tenant-Id': 'pinned-tenant',
      });
    });

    test('sends no per-user headers when no pattern matches', async () => {
      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test/rpc',
      });

      await provider.executeTool('test-tool', {}, {
        'http://other.test/*': { headers: { Authorization: 'Bearer user-token' } },
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers.Authorization).toBeUndefined();
    });
  });

  describe('executeTool client headers', () => {
    test('sends headers from a pattern with a domain', async () => {
      const provider = new RemoteMcpToolsProvider({ url: 'https://api.example.com/api/mcp' });

      await provider.executeTool('test-tool', {}, {
        'https://*.example.com/api/mcp': { headers: { Authorization: 'Bearer user-jwt' } },
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers.Authorization).toBe('Bearer user-jwt');
    });

    test('does not send headers from a pattern without a domain', async () => {
      const provider = new RemoteMcpToolsProvider({ url: 'https://api.example.com/api/mcp' });

      await provider.executeTool('test-tool', {}, {
        '*://*/api/mcp': { headers: { Authorization: 'Bearer user-jwt' } },
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers.Authorization).toBeUndefined();
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
