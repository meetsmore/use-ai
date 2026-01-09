# Events

The Agent User Interaction Protocol employs a streaming event-based architecture where events function as fundamental communication units between agents and frontends.

## Event Categories

Seven main event categories exist:

1. **Lifecycle Events** - Track agent run progression
2. **Text Message Events** - Handle streaming textual content
3. **Tool Call Events** - Manage tool executions
4. **State Management Events** - Synchronize agent-UI state
5. **Activity Events** - Represent ongoing progress
6. **Special Events** - Support custom functionality
7. **Draft Events** - Proposed developments under review

## Core Structure

All events share three base properties:

```typescript
interface BaseEvent {
  type: EventType;      // Event identifier
  timestamp?: number;   // Optional creation time
  rawEvent?: unknown;   // Optional original data
}
```

## Key Patterns

The protocol implements three primary interaction patterns:

### 1. Start-Content-End

Streams content incrementally (text, tool arguments):

```typescript
// Text message streaming
{ type: "TEXT_MESSAGE_START", messageId: "msg1", role: "assistant" }
{ type: "TEXT_MESSAGE_CONTENT", messageId: "msg1", delta: "Hello " }
{ type: "TEXT_MESSAGE_CONTENT", messageId: "msg1", delta: "world!" }
{ type: "TEXT_MESSAGE_END", messageId: "msg1" }
```

### 2. Snapshot-Delta

Synchronizes state efficiently using complete snapshots followed by JSON Patch updates:

```typescript
// Initial snapshot
{ type: "STATE_SNAPSHOT", state: { count: 0, items: [] } }

// Incremental updates
{ type: "STATE_DELTA", delta: [{ op: "replace", path: "/count", value: 1 }] }
{ type: "STATE_DELTA", delta: [{ op: "add", path: "/items/-", value: "item1" }] }
```

### 3. Lifecycle

Monitors agent runs with mandatory start/end events:

```typescript
{ type: "RUN_STARTED", threadId: "thread1", runId: "run1" }
// ... processing events ...
{ type: "RUN_FINISHED", threadId: "thread1", runId: "run1" }
// or
{ type: "RUN_ERROR", threadId: "thread1", runId: "run1", message: "..." }
```

## Event Types Reference

### Lifecycle Events

| Event | Required | Description |
|-------|----------|-------------|
| `RUN_STARTED` | Yes | Mandatory beginning of a run |
| `RUN_FINISHED` | Yes* | Mandatory ending (success) |
| `RUN_ERROR` | Yes* | Mandatory ending (failure) |
| `STEP_STARTED` | No | Optional progress tracking |
| `STEP_FINISHED` | No | Optional progress tracking |

*One of `RUN_FINISHED` or `RUN_ERROR` is required to end a run.

### Text Message Events

| Event | Description |
|-------|-------------|
| `TEXT_MESSAGE_START` | Begin streaming a message |
| `TEXT_MESSAGE_CONTENT` | Delta chunk of message content |
| `TEXT_MESSAGE_END` | Complete message streaming |

### Tool Call Events

| Event | Description |
|-------|-------------|
| `TOOL_CALL_START` | Begin tool invocation with ID and name |
| `TOOL_CALL_ARGS` | Stream JSON argument fragments |
| `TOOL_CALL_END` | Complete tool call |

### State Events

| Event | Description |
|-------|-------------|
| `STATE_SNAPSHOT` | Complete state representation |
| `STATE_DELTA` | Incremental RFC 6902 JSON Patch |
| `MESSAGES_SNAPSHOT` | Conversation history snapshot |

### Special Events

| Event | Description |
|-------|-------------|
| `RAW` | External system passthrough |
| `CUSTOM` | Application-specific events |

## Example: Complete Run Flow

```typescript
// 1. Run starts
{ type: "RUN_STARTED", threadId: "t1", runId: "r1" }

// 2. State initialization
{ type: "STATE_SNAPSHOT", state: { context: "user query" } }

// 3. Tool call
{ type: "TOOL_CALL_START", toolCallId: "tc1", toolCallName: "search" }
{ type: "TOOL_CALL_ARGS", toolCallId: "tc1", delta: '{"query":' }
{ type: "TOOL_CALL_ARGS", toolCallId: "tc1", delta: '"weather"}' }
{ type: "TOOL_CALL_END", toolCallId: "tc1" }

// 4. Response
{ type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" }
{ type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "The weather is sunny." }
{ type: "TEXT_MESSAGE_END", messageId: "m1" }

// 5. Run completes
{ type: "RUN_FINISHED", threadId: "t1", runId: "r1" }
```

## Source

https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/events.mdx
