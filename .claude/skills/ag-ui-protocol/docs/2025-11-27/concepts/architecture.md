# Core Architecture

AG-UI is a protocol enabling communication between front-end applications and AI agents through an event-driven architecture.

## Design Philosophy

The system prioritizes flexibility and minimal requirements. It operates on two fundamental principles:
1. Agents emit standardized event types during execution
2. The system supports bidirectional human-AI interaction

The architecture includes middleware that handles varying event formats and transport mechanisms (SSE, WebSockets, webhooks, etc.).

## System Structure

AG-UI uses a client-server model where:
- Frontend applications interact with AG-UI clients
- Clients communicate with backend agents using the AG-UI protocol
- A secure proxy can mediate communication between multiple agents

## Core Components

### Protocol Layer

The foundation relies on implementing a `run()` method that returns an observable stream of events. This universal pattern lets developers connect diverse agent frameworks.

```typescript
import { AbstractAgent } from "@ag-ui/client"

class MyAgent extends AbstractAgent {
  run(input: RunAgentInput): RunAgent {
    // Implementation returns Observable<BaseEvent>
  }
}
```

### HTTP Client

The standard `HttpAgent` supports both text-based SSE streaming and binary protocols for different performance needs.

```typescript
import { HttpAgent } from "@ag-ui/client"

const agent = new HttpAgent({
  url: "https://your-agent-endpoint.com/agent",
  headers: {
    Authorization: "Bearer your-api-key",
  },
})
```

### Event Types

The system defines 16 standardized events across categories:

**Lifecycle Events:**
- `RUN_STARTED` - Run begins
- `RUN_FINISHED` - Run completes successfully
- `RUN_ERROR` - Run fails with error
- `STEP_STARTED` - Optional step begins
- `STEP_FINISHED` - Optional step ends

**Text Message Events:**
- `TEXT_MESSAGE_START` - Message begins
- `TEXT_MESSAGE_CONTENT` - Message chunk
- `TEXT_MESSAGE_END` - Message complete

**Tool Call Events:**
- `TOOL_CALL_START` - Tool invocation begins
- `TOOL_CALL_ARGS` - Tool arguments streaming
- `TOOL_CALL_END` - Tool invocation complete

**State Events:**
- `STATE_SNAPSHOT` - Complete state
- `STATE_DELTA` - Incremental update (JSON Patch)
- `MESSAGES_SNAPSHOT` - Conversation history

**Special Events:**
- `RAW` - Passthrough from external systems
- `CUSTOM` - Application-specific

## Key Features

### State Management

State management happens through snapshots and incremental deltas using JSON Patch format (RFC 6902), minimizing data transfer.

### Tool Usage

The system supports tool usage with typed handoffs between agents and frontends.

### Agent-to-Agent Handoffs

Agents can delegate tasks to other specialized agents while maintaining conversation context.

### Event Validation

All events inherit from `BaseEvent` and include type information and timestamps, ensuring strict validation across the communication pipeline.

```typescript
interface BaseEvent {
  type: EventType;
  timestamp?: number;
  rawEvent?: unknown;
}
```

## Source

https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/architecture.mdx
