# use-ai High-Level Feature Requirements & Test Coverage

This document lists user-facing capabilities in requirements format with test coverage status.

**Legend:**
- ✅ TESTED - Feature has test coverage
- 🆗 OK - Not explicitly tested, but OK (implicitly tested or obvious by existence)
- ❌ NOT TESTED - Feature exists but lacks tests
- ⚠️ PARTIAL - Feature has some test coverage but gaps remain

---

## Client Features

### Tool Definition & Registration

✅ React components can expose tools (functions) to the AI using the useAI hook
✅ Tools can be defined with type-safe parameters using Zod schemas
✅ Tools can be defined without parameters
✅ Tools can be marked as requiring confirmation before execution
✅ Tool execution errors are caught and reported back to the AI
✅ Tools are automatically registered when components mount and unregistered when they unmount
✅ `useAI` can be enabled / disabled conditionally (e.g. for feature flags)
✅ `UseAIProvder` can be enabled / disabled conditionally (e.g. for feature flags)

### Component State Management

✅ Components can provide their current state to the AI via the prompt option
✅ The system waits for React re-renders after tool execution to capture updated state before responding
✅ Components can be marked as "invisible" to skip render waiting (for provider-type components)
✅ Multiple instances of the same component can register separate tools using unique IDs
✅ Tool names are automatically namespaced when component IDs are provided

### Chat & Conversation Management

✅ Chat history is automatically persisted to localStorage by default
✅ Users can create multiple chats and switch between them
✅ Chat titles are auto-generated from the first user message
✅ A maximum of 20 chats are stored by default, with oldest chats auto-deleted
✅ Users can delete individual chats from the history
✅ Chat messages persist across page reloads
✅ Full conversation context is maintained when resuming chats
✅ Messages support displayMode metadata for custom styling ('default' | 'error')
✅ Error messages are visually distinguished with light red backgrounds and red text
✅ Display modes are persisted with messages and restored on page reload
✅ Custom chat storage backends can be implemented via the ChatRepository interface

### User Interface

✅ A floating button provides access to the AI chat interface
✅ The floating button indicates connection status (green when connected, gray when offline)
✅ The floating button shows an unread indicator when new messages arrive
✅ A chat panel displays conversation history with timestamps
✅ The chat panel supports multi-line input with Shift+Enter for newlines
✅ The chat panel shows a "Thinking..." indicator while the AI processes requests
✅ Empty chat displays up to 4 randomly selected suggestions from all mounted components
✅ Users can click suggestions to send them as messages
❌ Custom UI components can replace the default floating button
❌ Custom UI components can replace the default chat panel
✅ The chat UI can be completely disabled by passing null to CustomButton and CustomChat props
❌ AI responses can render Markdown.
🆗 The UI can be themed.
❌ The chat UI can be optionally embedded anywhere. (e.g. in a sidebar)
❌ The user can upload files to be sent to the AI.
❌ The user can save commands as slash /commands to recall again in future.

### Model Selection
✅ The user can select an agent, if multiple agents are configured on the backend.

### Connection & Error Handling

✅ The client automatically connects to the WebSocket server on initialization
✅ The client automatically reconnects with exponential backoff on disconnect
✅ Connection status is exposed to components via the useAI hook
✅ The system prevents sending messages when disconnected
✅ Error messages are displayed in the chat UI with distinctive red styling (light red bubble, red text)
✅ Three error types are supported: API_OVERLOADED, RATE_LIMITED, UNKNOWN_ERROR
✅ Default English error messages are provided for all error types
✅ Custom error messages can be configured via the errorMessages prop on UseAIProvider
✅ Error codes are defined in an exhaustive enum shared between server and client
✅ Error messages persist across page reloads with displayMode metadata
❌ Custom error handlers can be provided via the onError callback

### Context & System Prompts

❌ A global system prompt can be configured to provide instructions to the AI
❌ The useAIContext hook provides access to connection state and chat management functions
   NOTE: The hook exists and chat management functions are tested via chat-management.integration.test.tsx,
   but the hook itself is not directly tested

### Internationalization (i18n)
🆗 All strings can be localized.

### MCP Integration (Client-Side)

❌ Custom headers can be provided for MCP requests via the mcpHeadersProvider
❌ The mcpHeadersProvider function is called on each AI invocation to get fresh headers
❌ MCP header providers support exact URL matching and glob patterns
   NOTE: Client-side MCP feature exists in implementation but has no test coverage

### Build / Packaging Requirements
❌ Developers can install a fully bundled version of the client library to avoid dependency conflicts.
✅ React 16 -> 18 is supported.

---

## Server Features

### Core Architecture

✅ The server coordinates communication between client applications and AI agents using WebSocket (Socket.IO)
✅ The AG-UI protocol is used for communication between client and server
✅ The server maintains separate sessions for each connected client
✅ The server tracks conversation history and tool calls per session
✅ The server exposes a /health endpoint for Kubernetes health checks

### Agent System

✅ Multiple AI agents can be configured (Claude, OpenAI, Google, etc. via AI SDK)
✅ The AISDKAgent integrates with any AI SDK language model
✅ Agents automatically handle multi-step tool execution (up to 10 steps)
✅ Custom agents can be implemented by implementing the Agent interface
⚠️ The system instructs the AI to ask for confirmation before calling confirmation-required tools

### Tool Execution Coordination

✅ The AI can run MCP tools to do tasks in the frontend
✅ The server coordinates tool calls between the AI and client
✅ The server waits for tool results from the client before continuing
✅ The server handles multiple sequential tool calls in a single conversation turn

### Rate Limiting

✅ Rate limiting can be configured per IP address using a sliding window algorithm
✅ The maximum number of requests per window can be configured via environment variables
✅ The window duration can be configured via environment variables
✅ Rate limiting can be disabled by setting max requests to 0
✅ Different clients have independent rate limits
✅ Rate limits reset after the time window expires
✅ The system returns helpful error messages with retry-after information when rate limited

### MCP (Model Context Protocol) Integration

✅ Remote MCP servers can be specified on the backend to provide additional tools
✅ Each MCP endpoint specifies a URL, optional headers, optional namespace prefix, and timeout
✅ MCP endpoints can be filtered using authorization provided by the use-ai client.
✅ MCP tool names are prefixed with namespace to avoid conflicts
✅ The server fetches MCP tool schemas on initialization using JSON-RPC 2.0
✅ The server retries failed MCP endpoint initialization up to 3 times
✅ MCP tools are executed via JSON-RPC 2.0 calls to the remote server
✅ MCP tool execution has configurable timeout (default 30 seconds)
⚠️ Custom headers can be added to MCP requests (server-wide)
⚠️ Custom headers can be added to MCP requests (per-request)
⚠️ Per-request headers override server-wide configured headers
✅ MCP header configuration supports exact URL matching and glob patterns
✅ MCP tool schemas can be periodically refreshed when configured
✅ MCP endpoints are cleaned up when the server shuts down

### Plugin Architecture

⚠️ The server supports plugins that extend functionality
⚠️ Plugins can register custom message handlers for new message types
⚠️ Plugins receive lifecycle hooks when clients connect and disconnect
⚠️ Plugins have access to the client session for state management

### Observability & Logging

✅ Structured logging is available in JSON or pretty-printed format
✅ Log format can be configured via LOG_FORMAT environment variable
✅ The logger supports info, warn, error, and debug levels
✅ The logger includes timestamps in all log entries
✅ The logger redacts sensitive header values in MCP logs (unless DEBUG=1)
✅ Langfuse observability can be enabled for LLM tracking and analytics
✅ Langfuse integration tracks conversation sessions, tool calls, and token usage
✅ Langfuse telemetry includes session metadata (sessionId, threadId, runId, ipAddress, toolCount)
✅ Langfuse observability is automatically enabled when LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are set

### Error Handling

✅ The server emits RUN_ERROR events when agent execution fails
✅ The server catches and handles AI SDK model errors
✅ The server detects API overload errors (HTTP 529) and sends API_OVERLOADED error code
✅ The server detects rate limiting errors (HTTP 429) and sends RATE_LIMITED error code
✅ The server sends structured error codes using the ErrorCode enum (not raw error messages)
✅ The server logs detailed error information including retry attempts for debugging
✅ The server handles MCP tool execution errors and propagates them to the AI
✅ The server emits helpful error messages when requested agents are not found
❌ The server supports aborting in-flight agent executions via ABORT_RUN messages

### Configuration

✅ The server port can be configured via PORT environment variable
✅ The server can be initialized with multiple agents
✅ API keys for different AI providers are read from environment variables
✅ The server validates that at least one agent is configured on startup
✅ MCP endpoint configuration can be provided via environment variables

---

## Protocol & Types

### AG-UI Protocol

✅ The AG-UI protocol defines standardized event types for AI-UI communication
✅ The protocol supports streaming text messages (TEXT_MESSAGE_START, _CONTENT, _END)
✅ The protocol supports streaming tool calls (TOOL_CALL_START, _ARGS, _END)
✅ The protocol supports run lifecycle events (RUN_STARTED, RUN_FINISHED, RUN_ERROR)
✅ The protocol supports state snapshots (STATE_SNAPSHOT, MESSAGES_SNAPSHOT)
🆗 The protocol supports thinking messages (THINKING_TEXT_MESSAGE_*, THINKING_START, THINKING_END)
   NOTE: Types are imported from @ag-ui/core but not implemented or tested in use-ai
🆗 The protocol supports chunked messages (TEXT_MESSAGE_CHUNK, TOOL_CALL_CHUNK)
   NOTE: Types are imported from @ag-ui/core; TEXT_MESSAGE_CHUNK tested, TOOL_CALL_CHUNK untested
🆗 The protocol supports activity tracking (ACTIVITY_SNAPSHOT, ACTIVITY_DELTA)
   NOTE: Types are imported from @ag-ui/core but not implemented or tested in use-ai
🆗 The protocol supports step tracking (STEP_STARTED, STEP_FINISHED)
   NOTE: Types are imported from @ag-ui/core but not implemented or tested in use-ai
🆗 The protocol supports raw and custom events (RAW, CUSTOM)
   NOTE: Types are imported from @ag-ui/core but not implemented or tested in use-ai
✅ All events support optional timestamps

### Message Types

✅ The protocol supports user, assistant, system, developer, and tool message roles
✅ Tool messages include tool call ID and result content
✅ Assistant messages can include tool calls
✅ The protocol supports activity messages for tracking activities
✅ The protocol supports binary content in messages (images, files, etc.)

### Type Safety & Exports

🆗 The client exports TypeScript types for all hooks, components, and configurations
🆗 The server exports TypeScript types for agents, plugins, and configurations
🆗 The core package exports AG-UI protocol types
🆗 Zod is re-exported from the client package for schema definitions