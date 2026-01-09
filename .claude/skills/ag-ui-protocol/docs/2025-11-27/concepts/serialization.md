# Serialization

Serialization in AG-UI provides a standard way to persist and restore the event stream that drives an agent-UI session.

## Use Cases

With a serialized stream you can:

- Restore chat history and UI state after reloads or reconnects
- Attach to running agents and continue receiving events
- Create branches (time travel) from any prior run
- Compact stored history to reduce size without losing meaning

## Core Concepts

### Stream Serialization

Convert the full event history to and from a portable representation (e.g., JSON) for storage in databases, files, or logs.

```typescript
// Serialize
const events: BaseEvent[] = [...]
const serialized = JSON.stringify(events)
await storage.save(threadId, serialized)

// Restore
const restored = JSON.parse(await storage.load(threadId))
```

### Event Compaction

Reduce verbose streams to snapshots while preserving semantics:

```typescript
declare function compactEvents(events: BaseEvent[]): BaseEvent[]
```

### Run Lineage

Track branches of conversation using `parentRunId`, forming a git-like append-only log that enables time travel and alternative paths.

## Updated Event Fields

The `RunStarted` event includes additional optional fields:

```typescript
type RunStartedEvent = BaseEvent & {
  type: EventType.RUN_STARTED
  threadId: string
  runId: string
  parentRunId?: string  // Parent for branching/time travel
  input?: AgentInput    // Exact agent input for this run
}
```

## Event Compaction

Common compaction rules:

| Stream Type | Compaction Rule |
|-------------|-----------------|
| Message streams | Combine `TEXT_MESSAGE_*` sequences into single snapshot |
| Tool calls | Collapse start/content/end into compact record |
| State | Merge consecutive `STATE_DELTA` into final `STATE_SNAPSHOT` |
| Run input | Remove messages already present in history |

### Before Compaction

```typescript
[
  { type: "TEXT_MESSAGE_START", messageId: "msg1", role: "user" },
  { type: "TEXT_MESSAGE_CONTENT", messageId: "msg1", delta: "Hello " },
  { type: "TEXT_MESSAGE_CONTENT", messageId: "msg1", delta: "world" },
  { type: "TEXT_MESSAGE_END", messageId: "msg1" },
  { type: "STATE_DELTA", patch: { op: "add", path: "/foo", value: 1 } },
  { type: "STATE_DELTA", patch: { op: "replace", path: "/foo", value: 2 } }
]
```

### After Compaction

```typescript
[
  {
    type: "MESSAGES_SNAPSHOT",
    messages: [{ id: "msg1", role: "user", content: "Hello world" }]
  },
  {
    type: "STATE_SNAPSHOT",
    state: { foo: 2 }
  }
]
```

## Branching and Time Travel

Setting `parentRunId` creates a git-like lineage:

```
run1 ─── run2 ─── run5 ─── run6
              │
              └── run3 ─── run4 (alternative branch)
```

### Example

```typescript
// Original run
{
  type: "RUN_STARTED",
  threadId: "thread1",
  runId: "run1",
  input: { messages: ["Tell me about Paris"] }
}

// Branch from run1
{
  type: "RUN_STARTED",
  threadId: "thread1",
  runId: "run2",
  parentRunId: "run1",
  input: { messages: ["Actually, tell me about London instead"] }
}
```

### Benefits

- Multiple branches in the same serialized log
- Immutable history (append-only)
- Deterministic time travel to any point

## Normalized Input

Messages already in history can be omitted from subsequent runs:

```typescript
// First run includes full message
{
  type: "RUN_STARTED",
  runId: "run1",
  input: { messages: [{ id: "msg1", role: "user", content: "Hello" }] }
}

// Second run omits already-present message
{
  type: "RUN_STARTED",
  runId: "run2",
  input: { messages: [{ id: "msg2", role: "user", content: "How are you?" }] }
  // msg1 omitted; already in history
}
```

## Implementation Notes

- Provide SDK helpers for compaction and (de)serialization
- Store streams append-only; prefer incremental writes
- Consider compression for long histories
- Add indexes by `threadId`, `runId`, and timestamps for fast retrieval

## Source

https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/serialization.mdx
