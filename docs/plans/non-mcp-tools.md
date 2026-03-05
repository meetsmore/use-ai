# Plan: Server-Side (Non-MCP) Tools for UseAIServer

## Context

The use-ai server currently supports two tool types:

1. **Client tools** — defined on the frontend with `defineTool()`, executed client-side via Socket.IO round-trip (`createClientToolExecutor` waits for `tool_result` message)
2. **MCP tools** — fetched from remote MCP endpoints, executed server-side via JSON-RPC (`createMcpToolExecutor` calls `RemoteMcpToolsProvider.executeTool`)

Users need a third type: **server tools** — defined directly in server code with an execute function, running in the server process with no HTTP or WebSocket round-trip. Use cases include database queries, internal API calls, and operations requiring server-side secrets.

## Public API

```typescript
import { UseAIServer, AISDKAgent, defineServerTool } from '@meetsmore-oss/use-ai-server';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const server = new UseAIServer({
  agents: { claude: new AISDKAgent({ model: anthropic('claude-sonnet-4-20250514') }) },
  defaultAgent: 'claude',
  tools: {
    // With Zod schema (type-safe execute args)
    getWeather: defineServerTool(
      'Get current weather for a city',
      z.object({ city: z.string() }),
      async ({ city }, context) => {
        return await fetchWeather(city);
      },
      { annotations: { readOnlyHint: true } }
    ),
    // Destructive tool (triggers approval flow)
    deleteRecord: defineServerTool(
      'Delete a database record',
      z.object({ id: z.string().describe('Record UUID') }),
      async ({ id }, context) => {
        await db.delete(id);
        return { deleted: true };
      },
      { annotations: { destructiveHint: true } }
    ),
    // No parameters
    getServerTime: defineServerTool(
      'Get the current server time',
      async () => new Date().toISOString()
    ),
  },
});
```

## Key Types

```typescript
// User-facing config (returned by defineServerTool)
interface ServerToolConfig {
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  execute: (args: Record<string, unknown>, context: ServerToolContext) => unknown | Promise<unknown>;
  annotations?: ToolAnnotations;
}

// Context provided to execute functions
interface ServerToolContext {
  /** The client session that triggered the tool call */
  session: ClientSession;
  /** Current application state from the client */
  state: unknown;
  /** Unique identifier for the current run */
  runId: string;
  /** Unique identifier for this specific tool call */
  toolCallId: string;
}

// Internal representation (mirrors RemoteToolDefinition._remote pattern)
interface ServerToolDefinition extends ToolDefinition {
  _server: {
    execute: ServerToolExecuteFn;
  };
}
```

## `defineServerTool` Helper

Two overloads mirroring the client-side `defineTool()` API:

```typescript
// Overload 1: With Zod schema (type-safe execute args)
function defineServerTool<TSchema extends z.ZodType>(
  description: string,
  schema: TSchema,
  execute: (args: z.infer<TSchema>, context: ServerToolContext) => unknown | Promise<unknown>,
  options?: { annotations?: ToolAnnotations }
): ServerToolConfig;

// Overload 2: No parameters
function defineServerTool(
  description: string,
  execute: (args: Record<string, never>, context: ServerToolContext) => unknown | Promise<unknown>,
  options?: { annotations?: ToolAnnotations }
): ServerToolConfig;
```

Internally, Zod schemas are converted to JSON Schema via `z.toJSONSchema()` (same as client `defineTool`).

## Execution Flow

### Tool Routing in `AISDKAgent.sanitizeToolsForAPI()`

```
for each tool:
  if isRemoteTool(tool)  → createMcpToolExecutor     (existing - JSON-RPC to remote endpoint)
  if isServerTool(tool)  → createServerToolExecutor   (NEW - direct function call)
  else                   → createClientToolExecutor    (existing - wait for client Socket.IO response)
```

### `createServerToolExecutor`

The simplest executor — a direct function call. No promises to wait on, no HTTP requests:

```typescript
function createServerToolExecutor(
  serverTool: ServerToolDefinition,
  session: ClientSession
): ToolExecutor {
  return async (args, { toolCallId }) => {
    const context: ServerToolContext = {
      session,
      state: session.state,
      runId: session.currentRunId || '',
      toolCallId,
    };
    return serverTool._server.execute(args, context);
  };
}
```

### Tool Merge in `handleRunAgent`

Server tools are stored once in the constructor, then merged into every session:

```typescript
// Constructor: convert config to ServerToolDefinition[]
this.serverTools = Object.entries(config.tools).map(([name, toolConfig]) => ({
  name,
  description: toolConfig.description,
  parameters: toolConfig.parameters,
  annotations: toolConfig.annotations,
  _server: { execute: toolConfig.execute },
}));

// handleRunAgent: merge all tool types
session.tools = [...clientTools, ...mcpTools, ...this.serverTools];
```

### Mid-Run Tool Preservation in `handleToolResult`

When the client sends updated tools mid-run, preserve server tools alongside MCP tools:

```typescript
const existingRemoteTools = session.tools.filter(isRemoteTool);
const existingServerTools = session.tools.filter(isServerTool);
session.tools = [...updatedClientTools, ...existingRemoteTools, ...existingServerTools];
```

### Tool Approval

Works unchanged — `toolNeedsApproval()` and `createApprovalWrapper()` are already type-agnostic. Server tools with `annotations: { destructiveHint: true }` go through the same client approval dialog.

## Patterns Reused

| Existing Pattern                       | New Pattern                                   |
| -------------------------------------- | --------------------------------------------- |
| `RemoteToolDefinition._remote`         | `ServerToolDefinition._server`                |
| `isRemoteTool()` type guard            | `isServerTool()` type guard                   |
| `createMcpToolExecutor()`              | `createServerToolExecutor()`                  |
| Client `defineTool()` Zod overloads    | `defineServerTool()` Zod overloads            |
| MCP merge in `handleRunAgent`          | Same pattern adds server tools                |
| MCP preservation in `handleToolResult` | Same pattern preserves server tools            |

## Implementation Steps

| Step | File                                                   | Action | Description                                                        |
| ---- | ------------------------------------------------------ | ------ | ------------------------------------------------------------------ |
| 1    | `packages/server/src/tools/types.ts`                   | NEW    | ServerToolConfig, ServerToolDefinition, ServerToolContext types     |
| 2    | `packages/server/src/tools/defineServerTool.ts`        | NEW    | Zod-based helper with overloads (schema / no-schema)               |
| 3    | `packages/server/src/tools/defineServerTool.test.ts`   | NEW    | Unit tests for defineServerTool                                    |
| 4    | `packages/server/src/tools/serverToolExecutor.ts`      | NEW    | createServerToolExecutor (direct function call)                    |
| 5    | `packages/server/src/tools/serverToolExecutor.test.ts` | NEW    | Unit tests for createServerToolExecutor                            |
| 6    | `packages/server/src/tools/index.ts`                   | NEW    | Barrel export                                                      |
| 7    | `packages/server/src/utils/toolFilters.ts`             | MODIFY | Add `isServerTool` type guard                                      |
| 8    | `packages/server/src/utils/index.ts`                   | MODIFY | Export `isServerTool`                                              |
| 9    | `packages/server/src/types.ts`                         | MODIFY | Add `tools?: Record<string, ServerToolConfig>` to UseAIServerConfig |
| 10   | `packages/server/src/server.ts`                        | MODIFY | Constructor converts config, handleRunAgent merges, handleToolResult preserves |
| 11   | `packages/server/src/agents/AISDKAgent.ts`             | MODIFY | Third branch in sanitizeToolsForAPI for server tools               |
| 12   | `packages/server/src/index.ts`                         | MODIFY | Export defineServerTool, types, isServerTool                       |
| 13   | Integration test                                       | NEW    | Full Socket.IO flow test with mock model                           |

## New Exports from `@meetsmore-oss/use-ai-server`

```typescript
// Function
export { defineServerTool } from './tools';

// Types
export type { ServerToolConfig, ServerToolContext, ServerToolDefinition } from './tools';

// Utility
export { isServerTool } from './utils';
```

## Potential Challenges

1. **Tool name conflicts**: If a client tool and server tool share a name, the last one in the merged array wins in `sanitizeToolsForAPI` (tools are converted to a `Record<string, ...>`). Merge order `[...clientTools, ...mcpTools, ...serverTools]` means server tools win. Should log a warning on conflict.

2. **Circular imports**: `tools/types.ts` imports `ClientSession` from `agents/types.ts`. This is one-directional (tools → agents). `AISDKAgent` imports from `tools/` which is also one-directional. No circularity.

3. **Plugin access**: The WorkflowsPlugin currently fetches MCP tools independently. If workflows also need server tools, the plugin interface would need extension. Out of scope for V1.

## Verification

1. `bun run test` — all existing + new unit tests pass
2. `bun run build` — server package builds with new exports
3. Manual: add a server tool to `apps/example/server/index.ts`, verify AI can call it and the result flows back
4. Verify destructiveHint approval flow works for server tools
5. Verify mid-run tool updates (navigation) don't lose server tools
