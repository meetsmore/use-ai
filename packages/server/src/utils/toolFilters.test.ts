import { describe, expect, test } from 'bun:test';
import { isRemoteTool, isServerTool, createGlobFilter, and, or, not } from './toolFilters';
import type { ToolDefinition } from '../types';
import type { RemoteToolDefinition } from '../mcp';
import type { ServerToolDefinition } from '../tools/types';

function createClientTool(name = 'client_tool'): ToolDefinition {
  return {
    name,
    description: 'A client tool',
    parameters: { type: 'object', properties: {} },
  };
}

function createRemoteTool(name = 'mcp_tool'): RemoteToolDefinition {
  return {
    name,
    description: 'An MCP tool',
    parameters: { type: 'object', properties: {} },
    _remote: { provider: {} as never, originalName: name },
  };
}

function createServerTool(name = 'server_tool'): ServerToolDefinition {
  return {
    name,
    description: 'A server tool',
    parameters: { type: 'object', properties: {} },
    _server: { execute: async () => 'result' },
  };
}

describe('isServerTool', () => {
  test('returns true for server tool definitions', () => {
    expect(isServerTool(createServerTool())).toBe(true);
  });

  test('returns false for client tool definitions', () => {
    expect(isServerTool(createClientTool())).toBe(false);
  });

  test('returns false for remote (MCP) tool definitions', () => {
    const tool = createRemoteTool();
    expect(isServerTool(tool)).toBe(false);
    expect(isRemoteTool(tool)).toBe(true);
  });
});

describe('isRemoteTool (existing)', () => {
  test('returns false for server tool definitions', () => {
    expect(isRemoteTool(createServerTool())).toBe(false);
  });
});

describe('tool filter combinators with server tools', () => {
  test('isServerTool works with and/or/not combinators', () => {
    const serverTool = createServerTool('server_db_query');
    const clientTool = createClientTool('client_addTodo');

    const serverOnly = isServerTool;
    const clientOnly = not(isServerTool);

    expect(serverOnly(serverTool)).toBe(true);
    expect(serverOnly(clientTool)).toBe(false);
    expect(clientOnly(serverTool)).toBe(false);
    expect(clientOnly(clientTool)).toBe(true);
  });

  test('can filter server tools by glob pattern', () => {
    const dbTool = createServerTool('db_query');
    const apiTool = createServerTool('api_fetch');

    const filter = and(isServerTool, createGlobFilter(['db_*']));

    expect(filter(dbTool)).toBe(true);
    expect(filter(apiTool)).toBe(false);
  });

  test('can combine server and remote tool filters', () => {
    const serverTool = createServerTool('server_tool');
    const remoteTool = createRemoteTool('mcp_tool');
    const clientTool = createClientTool('client_tool');

    const serverOrRemote = or(isServerTool, isRemoteTool);

    expect(serverOrRemote(serverTool)).toBe(true);
    expect(serverOrRemote(remoteTool)).toBe(true);
    expect(serverOrRemote(clientTool)).toBe(false);
  });
});
