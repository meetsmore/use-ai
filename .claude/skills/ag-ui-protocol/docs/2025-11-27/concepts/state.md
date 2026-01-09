# State Management

AG-UI provides a sophisticated state synchronization system for real-time coordination between AI agents and frontend applications.

## Core Architecture

The system operates on a shared state model where data persists across interactions and both parties can access and modify it. This creates a bidirectional communication channel enabling agents to make contextual decisions while frontends observe backend changes.

## Synchronization Methods

Two complementary approaches handle state updates:

### State Snapshots

Deliver complete state representations, typically during:
- Initialization
- After interruptions
- When major changes occur

Upon receipt, frontends should replace their existing state model entirely:

```typescript
{
  type: "STATE_SNAPSHOT",
  state: {
    user: { name: "Alice", preferences: { theme: "dark" } },
    conversation: { topic: "weather", started: "2024-01-15" }
  }
}
```

### State Deltas

Use JSON Patch format (RFC 6902) to send incremental changes. More bandwidth-efficient for:
- Frequent small updates
- Large objects where most properties remain static

```typescript
// Update a single field
{
  type: "STATE_DELTA",
  delta: [
    { op: "replace", path: "/user/preferences/theme", value: "light" }
  ]
}

// Add an item to an array
{
  type: "STATE_DELTA",
  delta: [
    { op: "add", path: "/items/-", value: { id: 3, name: "New Item" } }
  ]
}

// Remove a field
{
  type: "STATE_DELTA",
  delta: [
    { op: "remove", path: "/user/temporary" }
  ]
}
```

## JSON Patch Operations (RFC 6902)

| Operation | Description | Example |
|-----------|-------------|---------|
| `add` | Add a value | `{ op: "add", path: "/a/b", value: "c" }` |
| `remove` | Remove a value | `{ op: "remove", path: "/a/b" }` |
| `replace` | Replace a value | `{ op: "replace", path: "/a/b", value: "d" }` |
| `move` | Move a value | `{ op: "move", from: "/a/b", path: "/c/d" }` |
| `copy` | Copy a value | `{ op: "copy", from: "/a/b", path: "/c/d" }` |
| `test` | Test a value | `{ op: "test", path: "/a/b", value: "c" }` |

## Implementation

AG-UI implementations typically apply patches using libraries like `fast-json-patch`:

```typescript
import { applyPatch } from "fast-json-patch";

// Atomic operation that doesn't mutate original state
const newState = applyPatch(currentState, delta, true, false).newDocument;
```

If inconsistencies arise after applying patches, frontends can request a fresh snapshot.

## Real-World Example

CopilotKit exemplifies this approach:

**Frontend (React):**
```typescript
const { state, setState } = useCoAgent({
  name: "my-agent",
  initialState: { items: [] }
});

// Read state
console.log(state.items);

// Update state (triggers delta to agent)
setState(prev => ({ ...prev, items: [...prev.items, newItem] }));
```

**Backend (Agent):**
```python
# Emit state update
copilotkit_emit_state({
    "items": current_items,
    "lastUpdated": datetime.now().isoformat()
})
```

## Best Practices

1. **Judicious Snapshot Usage** - Use snapshots sparingly; prefer deltas for incremental changes
2. **Thoughtful State Structure** - Design state to minimize deep nesting
3. **Conflict Resolution** - Implement strategies for concurrent updates
4. **Error Recovery** - Handle patch failures gracefully with snapshot fallback
5. **Security** - Never include sensitive data in shared state
6. **Idempotency** - Design updates to be safely re-applicable

## When to Use Snapshots vs Deltas

| Use Case | Recommendation |
|----------|----------------|
| Initial connection | Snapshot |
| Reconnection after disconnect | Snapshot |
| Single field update | Delta |
| Multiple related updates | Delta (batched) |
| Major state restructure | Snapshot |
| Frequent small changes | Delta |

## Source

https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/state.mdx
