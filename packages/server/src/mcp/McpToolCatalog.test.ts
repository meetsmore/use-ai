import { describe, expect, test, spyOn } from 'bun:test';
import type { ClientSession } from '../agents/types';
import { McpToolCatalog, hashMcpHeaders } from './McpToolCatalog';
import { RemoteMcpToolsProvider, type RemoteToolDefinition } from './RemoteMcpToolsProvider';

function createProvider(url: string, toolsCacheTtl?: number) {
  const provider = new RemoteMcpToolsProvider({ url, toolsCacheTtl });
  const tool = { name: `tool-${url}` } as RemoteToolDefinition;
  const fetchSpy = spyOn(provider, 'fetchToolsWithHeaders').mockResolvedValue([tool]);
  return { provider, tool, fetchSpy };
}

function createSession(): ClientSession {
  return { clientId: 'client-1' } as ClientSession;
}

describe('hashMcpHeaders', () => {
  test('returns no-auth when there are no headers', () => {
    expect(hashMcpHeaders(undefined)).toBe('no-auth');
    expect(hashMcpHeaders({})).toBe('no-auth');
  });

  test('does not depend on the key order', () => {
    const a = hashMcpHeaders({ 'https://a/*': { headers: { x: '1', y: '2' } }, 'https://b/*': { headers: {} } });
    const b = hashMcpHeaders({ 'https://b/*': { headers: {} }, 'https://a/*': { headers: { y: '2', x: '1' } } });
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });
});

describe('McpToolCatalog', () => {
  test('fetches tools once and then uses the session cache', async () => {
    const { provider, tool, fetchSpy } = createProvider('https://mcp.example.com/a');
    const catalog = new McpToolCatalog([provider]);
    const session = createSession();

    expect(await catalog.getToolsForSession(session)).toEqual([tool]);
    expect(await catalog.getToolsForSession(session)).toEqual([tool]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(session.mcpHeadersHash).toBe('no-auth');
  });

  test('fetches again when the headers change and sends only the matching headers', async () => {
    const { provider, fetchSpy } = createProvider('https://mcp.example.com/a');
    const catalog = new McpToolCatalog([provider]);
    const session = createSession();

    await catalog.getToolsForSession(session);
    await catalog.getToolsForSession(session, {
      'https://mcp.example.com/*': { headers: { authorization: 'Bearer t' } },
      'https://other.example.com/*': { headers: { authorization: 'Bearer other' } },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toEqual({});
    expect(fetchSpy.mock.calls[1][0]).toEqual({ authorization: 'Bearer t' });
  });

  test('fetches again when the TTL of an endpoint expires', async () => {
    const { provider, fetchSpy } = createProvider('https://mcp.example.com/a', 1000);
    const catalog = new McpToolCatalog([provider]);
    const session = createSession();

    await catalog.getToolsForSession(session);
    session.mcpToolsCacheTimestamp = Date.now() - 1000;
    await catalog.getToolsForSession(session);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test('uses an empty list for an endpoint that fails and keeps the other tools', async () => {
    const failing = new RemoteMcpToolsProvider({ url: 'https://mcp.example.com/fail' });
    spyOn(failing, 'fetchToolsWithHeaders').mockRejectedValue(new Error('down'));
    const { provider, tool } = createProvider('https://mcp.example.com/ok');
    const catalog = new McpToolCatalog([failing, provider]);
    const session = createSession();

    expect(await catalog.getToolsForSession(session)).toEqual([tool]);
    expect(session.mcpToolsCache?.get('https://mcp.example.com/fail')).toEqual([]);
  });
});
