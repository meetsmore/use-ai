# NestJS MCP Server with MCP-Nest

A NestJS-based MCP (Model Context Protocol) server built using **[MCP-Nest](https://github.com/rekog-labs/MCP-Nest)** that exposes tools for testing remote MCP tool integration with use-ai.

## Overview

This server uses **MCP-Nest decorators** (`@Tool`) to define tools in a type-safe, declarative way. It exposes the native MCP protocol over HTTP:

### MCP Protocol Endpoints (JSON-RPC)
- `POST /mcp` - MCP JSON-RPC endpoint (supports `tools/list`, `tools/call`)
- `GET /sse` - Server-Sent Events for streaming
- `GET /mcp` - Session management (GET)
- `DELETE /mcp` - Session cleanup (DELETE)
- `POST /messages` - Message handling

## Available Tools

All tools are defined using MCP-Nest's `@Tool` decorator with Zod schemas:

1. **add** - Add two numbers together
2. **multiply** - Multiply two numbers
3. **greet** - Greet a person by name
4. **get_weather** - Get mock weather data for a location

## Usage

### Development
```bash
bun run dev
```

### Production
```bash
bun run start
```

The server runs on port 3002 by default (configurable via `MCP_PORT` environment variable).

## MCP-Nest Integration

Tools are defined using the `@Tool` decorator:

```typescript
@Tool({
  name: 'add',
  description: 'Add two numbers together',
  parameters: z.object({
    a: z.number().describe('The first number'),
    b: z.number().describe('The second number'),
  }),
})
async add({ a, b }: { a: number; b: number }) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ result: a + b }) }],
  };
}
```

The `McpModule` is configured with stateless HTTP transport:

```typescript
McpModule.forRoot({
  name: 'test-mcp-server',
  version: '1.0.0',
  streamableHttp: {
    enableJsonResponse: true,
    statelessMode: true,
  },
})
```

## Integration with use-ai

The server is configured in the use-ai example app's playwright config to:
1. Start automatically before running E2E tests
2. Provide remote tools to the UseAI server via the `MCP_ENDPOINT_URL` environment variable
3. Tools are namespaced with "mcp_" prefix (e.g., `mcp_add`, `mcp_multiply`)

## Testing

Remote MCP tools can be tested via:
1. The "Remote MCP Tools" page in the example app (http://localhost:3000/remote-mcp-tools)
2. E2E tests in `apps/example/test/remote-mcp-tools.e2e.test.ts`
3. Direct curl commands using MCP JSON-RPC:
   ```bash
   # List available tools
   curl -X POST http://localhost:3002/mcp \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

   # Call a tool
   curl -X POST http://localhost:3002/mcp \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"add","arguments":{"a":5,"b":3}},"id":2}'
   ```

## Architecture

- **ToolsService**: Contains tool implementations with `@Tool` decorators
- **McpModule**: Provides native MCP protocol support (JSON-RPC, SSE) via MCP-Nest
- **RemoteMcpToolsProvider**: UseAI server component that communicates with this server using MCP JSON-RPC
- Uses **NestJS 11** for dependency injection and modularity
- Uses **MCP-Nest 1.8.4** for complete MCP protocol implementation

### Communication Flow

1. UseAI server's `RemoteMcpToolsProvider` sends `tools/list` JSON-RPC request to `/mcp`
2. MCP-Nest discovers tools via `@Tool` decorators and returns tool schemas
3. When Claude calls a tool, `RemoteMcpToolsProvider` sends `tools/call` JSON-RPC request
4. MCP-Nest executes the decorated tool method and returns MCP-compliant response
5. Result is extracted and returned to Claude
