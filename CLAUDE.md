# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`use-ai` is a TypeScript monorepo for building AI-powered React applications. It enables React components to expose tools (functions) to Claude AI via a Socket.IO server, allowing users to control UI through natural language.

**Key Innovation**: Tools execute client-side where app state lives. Server coordinates between Claude API and client tools.

**Monorepo Structure:**
- `packages/core/` - AG-UI protocol types and events
- `packages/client/` - React hooks (`useAI`)
- `packages/server/` - Socket.IO server with plugin support
- `packages/plugin-workflows/` - Headless workflow execution (server plugin)
- `packages/plugin-workflows-client/` - Client hooks for workflows (`useAIWorkflow`)
- `apps/example/` - Example todo app

## Development Commands

**Never use `bun test` to run tests, always `bun run test`**.

```bash
# Setup
bun install
export ANTHROPIC_API_KEY=...

# Development (server must run first)
bun run start:server           # Port 8081
bun run dev                    # Port 3000

# Building
bun run build                  # All packages
bun run build:client           # Client only
bun run build:server           # Server only

# Testing
bun run test                   # Unit tests
bun run test:e2e               # E2E tests (requires ANTHROPIC_API_KEY)
bun run test:e2e:ui            # Interactive E2E UI

# Single test file
bun run test packages/server/src/agents/AISDKAgent.test.ts
cd apps/example && bunx playwright test test/chat-history.e2e.test.ts

# Utilities
bun run kill                   # Kill processes on ports 3000, 3002, 8081
```

### Environment Variables

**Server:**
- `ANTHROPIC_API_KEY` (required)
- `LOG_FORMAT` (optional): `pretty` (default) or `json`
- `RATE_LIMIT_MAX_REQUESTS` (optional): Max requests per window (0 = unlimited)
- `RATE_LIMIT_WINDOW_MS` (optional): Window in ms (default: 60000)
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` (optional): LLM observability

### WebSocket Protocol

Use `wss://your-domain.com` for secure WebSocket connections. For local development without SSL, use `ws://localhost:8081`.

## Core Architecture

### Data Flow

```
1. Client registers tools → Server stores definitions
2. User sends prompt + component state → Server forwards to Claude API
3. Claude returns tool_use blocks → Server sends tool_call to client
4. Client executes tool + waits for re-render → Sends tool_response back
5. Server sends results to Claude → Claude generates final response
```

### Key Patterns

#### Tool Definition

```typescript
import { defineTool } from '@meetsmore-oss/use-ai-client';
import { z } from 'zod';

const addTodo = defineTool(
  'Add a new todo item to the list',
  z.object({ text: z.string() }),
  (input) => ({ success: true, message: 'Todo added' })
);

// No arguments
const logout = defineTool('Log the user out', () => { /* ... */ });

// Requires confirmation
const deleteAccount = defineTool(
  'Delete account permanently',
  () => { /* ... */ },
  { confirmationRequired: true }
);
```

#### Component Integration

```typescript
useAI({
  tools: { addTodo, deleteTodo },
  prompt: `Todo List: ${JSON.stringify(todos)}`,  // State AI sees
  suggestions: ['Add a todo to buy groceries'],    // Empty chat suggestions (optional)
  invisible: true,                                  // For non-rendering components (optional)
  id: `Row ${rowIndex}`,                           // For multiple instances (optional)
});
```

**State Management:**
- Component state provided via `prompt` argument (serialized to string)
- Library waits for re-render before sending tool response to get updated state
- Use `invisible: true` for components that don't re-render (e.g., providers)
- Use `id` to differentiate multiple instances (prefixes tool names: `Row 1/updateLabel`)

**Suggestions:**
- Aggregated from all mounted hooks
- Up to 4 randomly selected suggestions shown in empty chat
- Click to send as message

#### Socket.IO Protocol

**Client → Server messages:**
- `run_agent`: User prompt with tools, state, conversation history (chat)
- `run_workflow`: Trigger headless workflow (use-ai extension)
- `tool_result`: Tool execution result
- `abort_run`: Cancel current run

**Server → Client events:**
- `TEXT_MESSAGE_*`: Streaming text responses
- `TOOL_CALL_*`: Tool execution requests
- `RUN_*`: Lifecycle events (started, finished, error)
- `STATE_SNAPSHOT`: Current app state
- `MESSAGES_SNAPSHOT`: Conversation history

### Plugin Architecture

Server supports plugins for extensibility. All plugins implement `UseAIServerPlugin` interface.

**Built-in Plugin:** `WorkflowsPlugin` for headless workflow execution.

```typescript
import { UseAIServer, AISDKAgent } from '@meetsmore-oss/use-ai-server';
import { WorkflowsPlugin, DifyWorkflowRunner } from '@meetsmore-oss/use-ai-plugin-workflows';
import { anthropic } from '@ai-sdk/anthropic';

const server = new UseAIServer({
  agents: { claude: new AISDKAgent({ model: anthropic('claude-3-5-sonnet-20241022') }) },
  defaultAgent: 'claude',
  plugins: [
    new WorkflowsPlugin({
      runners: new Map([
        ['dify', new DifyWorkflowRunner({
          apiBaseUrl: process.env.DIFY_API_URL || 'http://localhost:3001/v1',
          workflows: {
            'greeting-workflow': process.env.DIFY_GREETING_WORKFLOW_KEY!,
          },
        })],
      ]),
    }),
  ],
});
```

### Agent vs WorkflowRunner

**Agent** (`packages/server/src/agents/types.ts`):
- Handles conversational chat with history
- Used by `useAI` hook
- Default: `AISDKAgent` (uses Claude API via AI SDK)

**WorkflowRunner** (`packages/plugin-workflows/src/types.ts`):
- Handles stateless, button-triggered operations
- Used by `useAIWorkflow` hook
- Example: `DifyWorkflowRunner` (integrates with Dify.AI)

**Why separate?** Different lifecycles (multi-turn vs single-run), different integrations (LLMs vs workflow platforms).

#### Using Workflows

```typescript
import { useAIWorkflow } from '@meetsmore-oss/use-ai-plugin-workflows-client';

function PDFUploadButton() {
  const { trigger, status, text, error, connected } = useAIWorkflow('dify', 'greeting-workflow');

  const handleClick = async () => {
    await trigger({
      inputs: { username: 'Alice' },
      tools: { /* tools workflow can call */ },
      onProgress: (progress) => console.log(progress),
      onComplete: (result) => console.log(result),
      onError: (err) => console.error(err),
    });
  };

  return <button onClick={handleClick} disabled={!connected || status === 'running'}>Upload</button>;
}
```

### Chat History

Chat history is persisted to localStorage by default.

**Features:**
- Auto-save messages
- Auto-generate titles from first user message
- Built-in chat management UI
- Storage limit: 20 most recent chats

**Custom Storage:** Implement `ChatRepository` interface (see `packages/client/src/providers/chatRepository/types.ts`).

**Programmatic Access:**
```typescript
const { currentChatId, createNewChat, loadChat, deleteChat, listChats, clearCurrentChat } = useAIContext();
```

### Custom UI

Replace default chat UI:
```typescript
<UseAIProvider serverUrl="wss://your-server.com" CustomButton={MyButton} CustomChat={MyChat}>
  <App />
</UseAIProvider>
```

## Observability

Optional Langfuse integration tracks Claude API calls, token usage, tool calls, conversation history, costs, and errors. Enabled automatically when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set. See `packages/server/src/instrumentation.ts`.

## Security

- **Rate limiting**: Per-IP address (configured via env vars)
- **Client-only scope**: AI can only see/manipulate what's on the page
- **No backend API access**: V1 intentionally limits security risks
- **confirmationRequired**: Prompts AI for confirmation (not 100% foolproof)

Following [Simon Willison's "Lethal Trifecta"](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) mitigations.

## Testing Strategy

- **Unit tests**: Alongside source files, run with `bun test`
- **E2E tests**: Located in `apps/example/test/`, use Playwright with real Claude API calls
- **Langfuse integration tests**: Use Testcontainers (~3-4 min runtime), run with `bun run test:e2e:langfuse`

E2E tests are preferred for AI features to catch edge cases with real API interactions.

## Common Tasks

### Adding a New Tool
1. Define tool with `defineTool()` in component
2. Add to `useAI` hook's `tools` object
3. Update component state in `prompt` argument
4. Write unit + E2E tests

### Adding a New Feature
1. Update TypeScript types
2. Implement client-side changes first
3. Update server if needed (rare)
4. Add tests
5. Build packages: `bun run build:client` and/or `bun run build:server`
6. Verify in example app

### Debugging Socket.IO Issues
1. Check server logs (`LOG_FORMAT=pretty`)
2. Check browser console
3. Verify WebSocket upgrade in DevTools Network tab
4. Use Socket.IO debug mode: `localStorage.debug = '*'`

### Debugging AI Behavior
1. Check `prompt` being sent (component state)
2. Verify tool descriptions are clear
3. Check if multi-tool use is causing unexpected behavior
4. Review conversation history in server logs
5. Write E2E test to reproduce consistently

## Implementation Details

### Connection Management
- Socket.IO client per `useAI` hook
- Automatic reconnection with exponential backoff
- Provider monitors connection status

### Error Handling
- Tool execution errors sent back to Claude as `tool_result`
- Zod validation errors propagate as tool execution errors
- Server errors sent as `error` messages to client

### Build System
- Bun bundles code → TypeScript generates type declarations → ESM output
- Strict TypeScript mode enabled
- Never use `any` type unless unavoidable

### File Naming
- React components: PascalCase (`UseAIFloatingButton.tsx`)
- Utilities/hooks: camelCase (`defineTool.ts`, `useAI.ts`)

## Extensibility

### Creating Custom Agents

Implement `Agent` interface (see `packages/server/src/agents/types.ts`). Must emit AG-UI protocol events (`RUN_STARTED`, `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `RUN_FINISHED`/`RUN_ERROR`).

### Creating Custom WorkflowRunners

Implement `WorkflowRunner` interface (see `packages/plugin-workflows/src/types.ts`). Must emit AG-UI protocol events.

### Creating Custom Plugins

Implement `UseAIServerPlugin` interface (see `packages/server/src/plugins/types.ts`). Register message handlers and optional lifecycle hooks.

## Deployment

Server designed for Kubernetes deployment:
- In-memory state only (Socket.IO sessions)
- Can be horizontally scaled (requires sticky sessions or Redis adapter)
- Shared across multiple applications
- Requires only `ANTHROPIC_API_KEY` environment variable

## Known Limitations (V1)

- Conversation history is session-based (lost on disconnect)
- No authentication/authorization built-in
- Rate limiting is per-IP, not per-user
- No backend tool execution support
- Clustering requires sticky sessions or Redis adapter
