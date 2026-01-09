# MCP RBAC Tool Filtering Plan

This document outlines the plan to implement per-user tool filtering for MCP endpoints, enabling RBAC-based tool visibility.

## Executive Summary

**Current State**: MCP tools are fetched once at server startup without authentication headers. All users see the same tools regardless of their roles/permissions.

**Target State**: Tools are fetched on-demand with user auth headers, allowing the MCP server to filter tools based on the authenticated user's roles/permissions.

**Two-Part Solution**:
1. **use-ai changes**: Support passing auth headers for tool listing (not just invocation), with lazy/per-session tool fetching
2. **MCP-Nest changes**: Add RBAC filtering capability to the `tools/list` endpoint

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Architecture Overview](#2-architecture-overview)
3. [use-ai Implementation](#3-use-ai-implementation)
4. [MCP-Nest Implementation](#4-mcp-nest-implementation)
5. [Testing Strategy](#5-testing-strategy)
6. [Migration Path](#6-migration-path)
7. [Security Considerations](#7-security-considerations)

---

## 1. Problem Statement

### Current use-ai Behavior

```
Server Startup
      │
      ▼
RemoteMcpToolsProvider.initialize()
      │
      ├── POST /mcp (tools/list)      ← No auth headers sent
      │         │
      │         ▼
      │   Returns ALL tools           ← Same for everyone
      │
      ▼
Tools cached in memory               ← Static, never changes per-user
```

**Issues:**
- `RemoteMcpToolsProvider` fetches tools at startup (`server.ts:175-194`)
- `fetchSchema()` sends request WITHOUT per-user auth headers (`RemoteMcpToolsProvider.ts:111-165`)
- Only server-wide headers from `McpEndpointConfig.headers` are used
- Tools are cached globally - all users see the same tools

### Current MCP-Nest Behavior

```
tools/list request
      │
      ▼
McpToolsHandler.registerHandlers()
      │
      ▼
registry.getTools(mcpModuleId)       ← Returns ALL discovered tools
      │
      ▼
Returns full tool list               ← No filtering
```

**Issues:**
- `McpToolsHandler` returns ALL tools (`mcp-tools.handler.ts:66-100`)
- No filtering based on `request.user` or roles
- `@Tool()` decorator has no permission metadata
- Authentication only blocks unauthenticated users, not per-tool access

---

## 2. Architecture Overview

### Target Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              use-ai Client                                   │
│                                                                              │
│   User connects → mcpHeadersProvider() → auth headers available             │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              use-ai Server                                   │
│                                                                              │
│   1. Socket connects with auth headers in forwardedProps.mcpHeaders         │
│   2. On first run_agent, fetch tools with user's auth headers (lazy)        │
│   3. Cache tools per-session (keyed by auth token hash)                     │
│   4. Include only user-visible tools when calling AI agent                  │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 │ POST /mcp { method: 'tools/list' }
                                 │ Headers: { Authorization: Bearer <token> }
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MCP-Nest Server                                 │
│                                                                              │
│   1. Guard validates JWT token, attaches user to request                    │
│   2. McpToolsHandler receives list request with request.user                │
│   3. registry.getTools() filters by user's roles/permissions                │
│   4. Returns only authorized tools                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision                       | Rationale                                                    |
|--------------------------------|--------------------------------------------------------------|
| Lazy tool fetching             | Can't fetch at startup - no user context yet                 |
| Per-session tool caching       | Avoid re-fetching on every request; invalidate on reconnect  |
| Cache key by auth token hash   | Different users get different tool sets                      |
| Pass headers via JSON-RPC body | MCP protocol doesn't specify header forwarding; use metadata |
| RBAC in MCP-Nest handler       | Centralized filtering, works with any MCP client             |

---

## 3. use-ai Implementation

### Phase 1: Lazy Tool Fetching

**File**: `packages/server/src/mcp/RemoteMcpToolsProvider.ts`

#### Step 1.1: Remove eager loading from initialize()

```typescript
// Before (lines 60-83)
async initialize(): Promise<void> {
  // Fetches tools immediately with retries
  await this.fetchSchema();
}

// After
async initialize(): Promise<void> {
  // Just validate the endpoint is reachable, don't fetch tools
  logger.mcpEndpoint(`Configured MCP endpoint: ${this.url}`);
  // Tools will be fetched lazily on first request
}
```

#### Step 1.2: Add fetchToolsWithHeaders() method

```typescript
/**
 * Fetches tools from MCP endpoint with authentication headers.
 * Called on first run_agent request per session.
 *
 * @param headers - User-specific auth headers from mcpHeadersProvider
 * @returns List of tools the user is authorized to access
 */
async fetchToolsWithHeaders(headers: Record<string, string>): Promise<ToolDefinition[]> {
  const mergedHeaders = {
    'Content-Type': 'application/json',
    ...this.config.headers,  // Server-wide headers
    ...headers,              // Per-user auth headers
  };

  const response = await fetch(this.url, {
    method: 'POST',
    headers: mergedHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/list',
      params: {},
    }),
    signal: AbortSignal.timeout(this.config.timeout || 30000),
  });

  if (!response.ok) {
    throw new McpEndpointError(`Failed to fetch tools: ${response.status}`);
  }

  const result = await response.json();
  if (result.error) {
    throw new McpEndpointError(result.error.message);
  }

  return this.convertMcpToolsToUseAI(result.result.tools);
}
```

### Phase 2: Session-Scoped Tool Management

**File**: `packages/server/src/server.ts`

#### Step 2.1: Add tool cache to ClientSession

```typescript
// In types.ts
interface ClientSession {
  // ... existing fields

  /** Cached MCP tools for this session, fetched lazily */
  mcpToolsCache?: Map<string, ToolDefinition[]>;

  /** Hash of auth headers used for cache key */
  mcpHeadersHash?: string;
}
```

#### Step 2.2: Implement lazy tool fetching in run_agent handler

```typescript
// In server.ts handleRunAgent()
private async handleRunAgent(session: ClientSession, data: RunAgentInput): Promise<void> {
  const mcpHeaders = data.forwardedProps?.mcpHeaders as McpHeadersMap | undefined;

  // Compute cache key from headers
  const headersHash = mcpHeaders
    ? this.hashHeaders(mcpHeaders)
    : 'no-auth';

  // Fetch tools if not cached or headers changed
  if (!session.mcpToolsCache || session.mcpHeadersHash !== headersHash) {
    session.mcpToolsCache = await this.fetchMcpToolsForSession(mcpHeaders);
    session.mcpHeadersHash = headersHash;
    logger.debug('Fetched MCP tools for session', {
      toolCount: session.mcpToolsCache.size,
      endpoints: Array.from(session.mcpToolsCache.keys()),
    });
  }

  // Continue with agent execution using cached tools
  const mcpTools = this.flattenMcpTools(session.mcpToolsCache);
  // ...
}

private async fetchMcpToolsForSession(
  mcpHeaders?: McpHeadersMap
): Promise<Map<string, ToolDefinition[]>> {
  const toolsMap = new Map<string, ToolDefinition[]>();

  for (const endpoint of this.mcpEndpoints) {
    const headers = this.resolveHeadersForEndpoint(endpoint.url, mcpHeaders);
    try {
      const tools = await endpoint.fetchToolsWithHeaders(headers);
      toolsMap.set(endpoint.url, tools);
    } catch (error) {
      logger.warn(`Failed to fetch tools from ${endpoint.url}`, { error });
      toolsMap.set(endpoint.url, []); // Empty on error, don't block
    }
  }

  return toolsMap;
}

private hashHeaders(headers: McpHeadersMap): string {
  // Simple hash for cache key - use stable JSON stringify + hash
  const sortedEntries = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
  return crypto.createHash('sha256')
    .update(JSON.stringify(sortedEntries))
    .digest('hex')
    .substring(0, 16);
}
```

### Phase 3: Client-Side Support

**File**: `packages/client/src/client.ts`

The client already supports `mcpHeadersProvider` for tool invocation. Ensure headers are available before first `sendPrompt()`.

**No headers case**: When `mcpHeadersProvider` is not configured:
- Client sends `run_agent` without `mcpHeaders` in `forwardedProps`
- Server fetches tools with only server-wide headers (from `McpEndpointConfig.headers`)
- All users see the same tools (no per-user filtering)
- This is the existing behavior and remains fully supported

```typescript
// Current implementation already handles this (lines 351-359)
async sendPrompt(prompt: string) {
  let mcpHeaders: McpHeadersMap | undefined;
  if (this.mcpHeadersProvider) {
    mcpHeaders = await this.mcpHeadersProvider();  // Optional - may not be configured
  }

  // Headers sent with every run_agent - server uses for tool fetch + invocation
  const runInput: RunAgentInput = {
    forwardedProps: {
      ...(mcpHeaders ? { mcpHeaders } : {}),  // Omitted entirely if no provider
    },
  };
}
```

No changes needed to client - headers are already optional. Server handles both cases:
- **With headers**: Lazy fetch per-session with user's auth headers
- **Without headers**: Lazy fetch once using only server-wide headers (shared across sessions)

### Phase 4: Configuration Options

**File**: `packages/server/src/types.ts`

**Simplified approach**: Always use lazy fetching. One code path, no configuration flags.

- Tools are fetched on first `run_agent` request (not at startup)
- If `mcpHeaders` provided: fetched per-session with user's headers
- If no `mcpHeaders`: fetched once and shared across all sessions (same as current eager behavior, just deferred)

```typescript
interface McpEndpointConfig {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  namespace?: string;

  // Removed: refreshInterval - not compatible with per-user tool lists
  // If tools change, users reconnect to get fresh list

  /**
   * Cache TTL for tool lists in milliseconds.
   * After this duration, tools are re-fetched on next run_agent.
   * Default: 0 (cache for entire session, no TTL)
   */
  toolsCacheTtl?: number;
}
```

**Breaking change**: `refreshInterval` is removed. It doesn't make sense when tools can differ per-user. Users who need fresh tools should:
1. Set `toolsCacheTtl` for automatic refresh
2. Reconnect the socket (clears session cache)
3. For truly static tools (no per-user filtering), the shared cache still works

---

## 4. MCP-Nest Implementation

### Design Approach: NestJS Guards for Tool Access

Instead of adding RBAC-specific fields (`roles`, `scopes`) to the `@Tool()` decorator, we use **NestJS guards** - the standard NestJS pattern for access control. This approach:

- **Reuses existing patterns** - Same guards used for HTTP routes work for tools
- **No RBAC coupling** - Users implement their own auth logic in guards
- **Single mechanism** - Same guard controls both listing and execution
- **Composable** - Multiple guards can be combined

### Phase 1: Add Guards Support to @Tool()

**File**: `src/mcp/decorators/tool.decorator.ts`

```typescript
import { CanActivate, Type } from '@nestjs/common';

export interface ToolOptions {
  name: string;
  description: string;
  parameters?: ZodSchema;
  outputSchema?: ZodSchema;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;

  /**
   * Guards that control access to this tool.
   * Tool is hidden from listing and blocked from execution if guards reject.
   * Uses the same NestJS guard pattern as @UseGuards().
   */
  guards?: Type<CanActivate>[];
}

export function Tool(options: ToolOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(TOOL_METADATA_KEY, {
      ...options,
      methodName: propertyKey,
    }, target, propertyKey);
    return descriptor;
  };
}
```

**Usage Examples:**

```typescript
// Example 1: Use existing NestJS guard
@Tool({
  name: 'admin-report',
  description: 'Generate admin reports',
  parameters: z.object({ reportType: z.string() }),
  guards: [AdminGuard],  // Existing guard from your app
})
async generateReport(args, context, request) {
  // Tool implementation
}

// Example 2: Create a tool-specific guard
@Injectable()
class ProfileReadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    return user?.scopes?.includes('profile:read');
  }
}

@Tool({
  name: 'user-profile',
  description: 'View user profile',
  parameters: z.object({ userId: z.string() }),
  guards: [ProfileReadGuard],
})
async viewProfile(args, context, request) {
  // Tool implementation
}

// Example 3: Multiple guards (AND logic - all must pass)
@Tool({
  name: 'sensitive-data',
  description: 'Access sensitive data',
  parameters: z.object({ dataId: z.string() }),
  guards: [AuthGuard, AdminGuard, AuditLogGuard],
})
async getSensitiveData(args, context, request) {
  // Tool implementation
}

// Example 4: No guards = public tool
@Tool({
  name: 'public-info',
  description: 'Get public information',
  parameters: z.object({}),
  // No guards - accessible to all authenticated users (or all users if no transport-level guards)
})
async getPublicInfo(args, context, request) {
  // Tool implementation
}
```

### Phase 2: Guard Execution in Handler

**File**: `src/mcp/services/handlers/mcp-tools.handler.ts`

```typescript
import { ModuleRef } from '@nestjs/core';
import { CanActivate, ExecutionContext } from '@nestjs/common';

export class McpToolsHandler {
  constructor(
    private readonly registry: McpRegistryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Check if all guards for a tool pass.
   * Returns true if tool has no guards or all guards pass.
   */
  private async checkToolGuards(
    tool: DiscoveredTool<ToolMetadata>,
    request: Request,
  ): Promise<boolean> {
    const guards = tool.metadata.guards;
    if (!guards || guards.length === 0) {
      return true; // No guards = public
    }

    // Create execution context for guards
    const context = this.createExecutionContext(request, tool);

    // Check all guards (AND logic)
    for (const GuardClass of guards) {
      const guard = this.moduleRef.get(GuardClass, { strict: false });
      const canActivate = await guard.canActivate(context);
      if (!canActivate) {
        return false;
      }
    }

    return true;
  }

  private createExecutionContext(request: Request, tool: DiscoveredTool<ToolMetadata>): ExecutionContext {
    // Create a minimal ExecutionContext that guards can use
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => null,
        getNext: () => null,
      }),
      getClass: () => tool.parentClass,
      getHandler: () => tool.methodRef,
      getArgs: () => [request],
      getArgByIndex: (index: number) => index === 0 ? request : undefined,
      getType: () => 'http',
    } as ExecutionContext;
  }
}
```

### Phase 3: Filtered Tool Listing

```typescript
// In mcp-tools.handler.ts
async function listTools(request: ListToolsRequest): Promise<ListToolsResult> {
  const httpRequest = this.getHttpRequest();

  // Get all tools for this module
  const allTools = this.registry.getTools(mcpModuleId);

  // Filter tools based on guard checks
  const accessibleTools: DiscoveredTool<ToolMetadata>[] = [];

  for (const tool of allTools) {
    const canAccess = await this.checkToolGuards(tool, httpRequest);
    if (canAccess) {
      accessibleTools.push(tool);
    }
  }

  // Convert to MCP protocol format
  return {
    tools: accessibleTools.map(tool => ({
      name: tool.metadata.name,
      description: tool.metadata.description,
      inputSchema: zodToJsonSchema(tool.metadata.parameters),
      annotations: tool.metadata.annotations,
    })),
  };
}
```

### Phase 4: Guard Check on Execution

```typescript
// In callTool handler
async function callTool(request: CallToolRequest): Promise<CallToolResult> {
  const httpRequest = this.getHttpRequest();

  const toolInfo = this.registry.findTool(mcpModuleId, request.params.name);
  if (!toolInfo) {
    throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${request.params.name}`);
  }

  // Check guards before execution (same check as listing)
  const canAccess = await this.checkToolGuards(toolInfo, httpRequest);
  if (!canAccess) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Access denied: insufficient permissions for tool '${request.params.name}'`
    );
  }

  // Continue with existing execution logic...
}
```

### Phase 5: Request Context Propagation

**File**: `src/mcp/transport/sse.controller.factory.ts`

Ensure HTTP request is accessible in handlers via AsyncLocalStorage or similar:

```typescript
import { AsyncLocalStorage } from 'async_hooks';

// Module-level storage for request context
export const requestContext = new AsyncLocalStorage<Request>();

@Post(messagesEndpoint)
@UseGuards(...guards)
async messages(@Req() rawReq: Request, @Res() rawRes: Response, @Body() body: unknown) {
  // Run handler within request context
  return requestContext.run(rawReq, async () => {
    return this.mcpService.handleMessage(body);
  });
}

// In handler
getHttpRequest(): Request | undefined {
  return requestContext.getStore();
}
```

### Alternative: Use Existing @UseGuards()

If modifying the `@Tool()` decorator is not desired, an alternative is to read `@UseGuards()` metadata from the method:

```typescript
// User's code - uses standard NestJS decorator
@UseGuards(AdminGuard)
@Tool({
  name: 'admin-report',
  description: 'Generate admin reports',
  parameters: z.object({ reportType: z.string() }),
})
async generateReport(args, context, request) {
  // ...
}

// Handler reads guards from metadata
private getToolGuards(tool: DiscoveredTool<ToolMetadata>): Type<CanActivate>[] {
  // Read @UseGuards() metadata from the method
  const guards = Reflect.getMetadata(GUARDS_METADATA, tool.methodRef) || [];
  return guards;
}
```

This approach has pros/cons:
- **Pro**: Uses standard NestJS decorator, no API changes
- **Con**: `@UseGuards()` might be confusing since it's typically for HTTP routes
- **Con**: Guard order matters - `@UseGuards()` must come before `@Tool()`

**Recommendation**: Add `guards` option to `@Tool()` for clarity, but support reading `@UseGuards()` as a fallback.

---

## 5. Testing Strategy

### use-ai Tests

**Unit Tests** (`packages/server/src/mcp/RemoteMcpToolsProvider.test.ts`):

```typescript
describe('RemoteMcpToolsProvider', () => {
  describe('fetchToolsWithHeaders', () => {
    test('sends auth headers with tools/list request', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => ({ result: { tools: [] } }),
      });
      global.fetch = mockFetch;

      const provider = new RemoteMcpToolsProvider({ url: 'http://mcp.test' });
      await provider.fetchToolsWithHeaders({ Authorization: 'Bearer token123' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://mcp.test',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token123',
          }),
        })
      );
    });

    test('merges server-wide and per-user headers', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => ({ result: { tools: [] } }),
      });
      global.fetch = mockFetch;

      const provider = new RemoteMcpToolsProvider({
        url: 'http://mcp.test',
        headers: { 'X-Server': 'static' },
      });
      await provider.fetchToolsWithHeaders({ Authorization: 'Bearer token' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://mcp.test',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Server': 'static',
            Authorization: 'Bearer token',
          }),
        })
      );
    });
  });
});
```

**E2E Tests** (`apps/example/test/mcp-rbac.e2e.test.ts`):

```typescript
test('different users see different tools based on roles', async ({ page }) => {
  // Login as admin
  await loginAs(page, 'admin@test.com');
  await page.fill('[data-testid="chat-input"]', 'What tools do you have?');
  await page.click('[data-testid="send-button"]');

  const adminResponse = await page.textContent('[data-testid="assistant-message"]');
  expect(adminResponse).toContain('admin-report');
  expect(adminResponse).toContain('user-profile');

  // Login as regular user
  await loginAs(page, 'user@test.com');
  await page.fill('[data-testid="chat-input"]', 'What tools do you have?');
  await page.click('[data-testid="send-button"]');

  const userResponse = await page.textContent('[data-testid="assistant-message"]');
  expect(userResponse).not.toContain('admin-report');  // Should not see admin tool
  expect(userResponse).toContain('user-profile');
});
```

### MCP-Nest Tests

**Unit Tests** (`tests/mcp-tools-guards.spec.ts`):

```typescript
describe('McpToolsHandler Guards', () => {
  // Mock guard that checks for admin role
  @Injectable()
  class AdminGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const request = context.switchToHttp().getRequest();
      return request.user?.roles?.includes('admin');
    }
  }

  test('filters tools by guard results', async () => {
    const adminRequest = { user: { roles: ['admin'] } };
    const userRequest = { user: { roles: ['user'] } };

    const tools = [
      { metadata: { name: 'public-tool' } },  // No guards
      { metadata: { name: 'admin-tool', guards: [AdminGuard] } },
    ];

    const handler = new McpToolsHandler(mockRegistry, mockModuleRef);

    // Admin sees both tools
    const adminTools = await handler.listToolsFiltered(tools, adminRequest);
    expect(adminTools.map(t => t.name)).toEqual(['public-tool', 'admin-tool']);

    // User only sees public tool
    const userTools = await handler.listToolsFiltered(tools, userRequest);
    expect(userTools.map(t => t.name)).toEqual(['public-tool']);
  });

  test('multiple guards use AND logic', async () => {
    @Injectable()
    class AuthGuard implements CanActivate {
      canActivate(context: ExecutionContext): boolean {
        return !!context.switchToHttp().getRequest().user;
      }
    }

    const tools = [
      { metadata: { name: 'needs-both', guards: [AuthGuard, AdminGuard] } },
    ];

    const handler = new McpToolsHandler(mockRegistry, mockModuleRef);

    // Authenticated admin passes both guards
    const adminResult = await handler.checkToolGuards(tools[0], { user: { roles: ['admin'] } });
    expect(adminResult).toBe(true);

    // Authenticated non-admin fails AdminGuard
    const userResult = await handler.checkToolGuards(tools[0], { user: { roles: ['user'] } });
    expect(userResult).toBe(false);

    // Unauthenticated fails AuthGuard
    const anonResult = await handler.checkToolGuards(tools[0], {});
    expect(anonResult).toBe(false);
  });
});
```

**E2E Tests** (`tests/mcp-tool-rbac.e2e.spec.ts`):

```typescript
describe('MCP Tool RBAC E2E', () => {
  test('admin sees admin tools, user does not', async () => {
    // Get admin token
    const adminToken = await getJwtToken({ role: 'admin' });

    // List tools as admin
    const adminResponse = await fetch('http://localhost:3000/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'tools/list',
      }),
    });

    const adminTools = (await adminResponse.json()).result.tools;
    expect(adminTools.some(t => t.name === 'admin-tool')).toBe(true);

    // Get user token
    const userToken = await getJwtToken({ role: 'user' });

    // List tools as user
    const userResponse = await fetch('http://localhost:3000/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'tools/list',
      }),
    });

    const userTools = (await userResponse.json()).result.tools;
    expect(userTools.some(t => t.name === 'admin-tool')).toBe(false);
  });

  test('user cannot execute tool they are not authorized for', async () => {
    const userToken = await getJwtToken({ role: 'user' });

    const response = await fetch('http://localhost:3000/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'tools/call',
        params: { name: 'admin-tool', arguments: {} },
      }),
    });

    const result = await response.json();
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain('Access denied');
  });
});
```

---

## 6. Migration Path

### Phase 1: use-ai Changes

1. Switch from eager to lazy tool fetching (breaking change)
2. Remove `refreshInterval` config option
3. Add per-session tool caching with optional `toolsCacheTtl`
4. Document migration in CLAUDE.md and release notes

**Migration for users:**
- If using `refreshInterval`: switch to `toolsCacheTtl` or socket reconnection
- If relying on startup tool validation: handle tool fetch errors in `run_agent` handler
- No changes needed if using basic setup without `refreshInterval`

### Phase 2: MCP-Nest Guards (Independent)

1. Add `guards` option to `@Tool()` decorator
2. Implement `checkToolGuards()` in `McpToolsHandler`
3. Filter tools in `listTools` based on guard results
4. Check guards before tool execution
5. All changes are additive - existing tools without guards remain public

**Migration for users:**
- No breaking changes - existing tools work as before
- Optionally add `guards: [YourGuard]` to tools needing access control

### Phase 3: Integration Testing

1. Update use-ai example app with per-user tool filtering demo
2. Add E2E tests covering the full flow
3. Document recommended patterns

### Rollout Checklist

- [ ] **use-ai**: Switch to lazy fetching, remove `refreshInterval`
- [ ] **MCP-Nest PR**: Add `guards` option and filtering
- [ ] **Documentation**: Update both READMEs with guard examples
- [ ] **Example app**: Add guard-based tool visibility demo

---

## 7. Security Considerations

### Defense in Depth

1. **Tool Hiding**: Users don't see tools they can't use (information disclosure prevention)
2. **Execution Check**: Even if tool name is guessed, execution is blocked
3. **Token Validation**: Standard JWT validation via guards
4. **Header Isolation**: Per-user headers prevent token leakage

### Known Limitations

1. **Tool Enumeration**: If tool names are predictable, users might try to call hidden tools
   - Mitigation: Execution authorization check

2. **Token Scope Inflation**: If MCP server trusts headers blindly
   - Mitigation: MCP server should validate JWT, not just pass through

3. **Cache Invalidation**: If user roles change mid-session
   - Mitigation: `toolsCacheTtl` config, or force reconnect on role change

### Recommended Security Patterns

```typescript
// DON'T: Trust client-provided data in guards
@Injectable()
class BadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return request.body.isAdmin; // Client can lie!
  }
}

// DO: Validate from JWT claims (set by authentication guard)
@Injectable()
class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    // request.user is set by JWT guard from validated token
    return request.user?.roles?.includes('admin');
  }
}

@Tool({
  name: 'admin-tool',
  guards: [AdminGuard],
})

// DO: Query trusted backend for authorization
@Injectable()
class OrgMemberGuard implements CanActivate {
  constructor(private readonly orgService: OrgService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const orgId = request.body?.orgId;

    // Query database to verify membership
    const membership = await this.orgService.getMembership(user.id, orgId);
    return membership?.role === 'admin';
  }
}

@Tool({
  name: 'org-tool',
  guards: [OrgMemberGuard],
})
```

---

## Appendix: File References

### use-ai Files to Modify

| File                                               | Changes                                              |
|----------------------------------------------------|------------------------------------------------------|
| `packages/server/src/mcp/RemoteMcpToolsProvider.ts`| Add `fetchToolsWithHeaders()`, remove eager `initialize()` |
| `packages/server/src/server.ts`                    | Lazy tool fetching, session-scoped cache             |
| `packages/server/src/types.ts`                     | Remove `refreshInterval`, add `toolsCacheTtl`        |
| `packages/core/src/types.ts`                       | (No changes needed - headers already supported)      |

### MCP-Nest Files to Modify

| File                                               | Changes                                              |
|----------------------------------------------------|------------------------------------------------------|
| `src/mcp/interfaces/mcp-tool.interface.ts`         | Add `guards` field to `ToolMetadata`                 |
| `src/mcp/decorators/tool.decorator.ts`             | Support `guards` option                              |
| `src/mcp/services/handlers/mcp-tools.handler.ts`   | Add `checkToolGuards()`, filter in listing/execution |
| `src/mcp/transport/sse.controller.factory.ts`      | Request context propagation (if not already done)    |

---

## Summary

This plan enables per-user MCP tool filtering through:

1. **use-ai**: Lazy tool fetching with user auth headers (instead of eager startup fetch)
2. **MCP-Nest**: NestJS guards for tool access control (same guards for listing and execution)

Key design decisions:
- **Single code path** in use-ai - no eager/lazy toggle
- **NestJS-native** in MCP-Nest - uses guards instead of custom RBAC fields
- **No breaking changes** for MCP-Nest users - guards are optional
- **Defense-in-depth** - tools are hidden AND blocked from execution
