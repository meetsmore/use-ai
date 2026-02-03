# Plan: Tool Execution Status in Chat UI

## Overview

Add a feature to show tool execution status in the chat UI while tools are running. The status displays the tool's `annotations.title` (e.g., "Search Appointments...") or falls back to configurable generic messages.

Additionally, replace the custom `confirmationRequired` option with the MCP-standard `destructiveHint` annotation (breaking change).

## Files to Modify

| File                                                | Change                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/client/src/defineTool.ts`                 | Add `ToolAnnotations`, remove `confirmationRequired`              |
| `packages/client/src/theme/strings.ts`              | Add `toolExecution.fallbackMessages`                              |
| `packages/client/src/components/UseAIChat.tsx`      | Add `executingTool` to `ChatUIContextValue`                       |
| `packages/client/src/providers/useAIProvider.tsx`   | Track executing tool, expose via context                          |
| `packages/client/src/components/UseAIChatPanel.tsx` | Display tool status in loading indicator                          |

## Implementation Details

### 1. defineTool.ts - Add ToolAnnotations (MCP-aligned)

Following the [MCP Tool Annotations spec](https://modelcontextprotocol.io/specification/2025-06-18/server/tools):

```typescript
/**
 * Tool annotations following the MCP (Model Context Protocol) specification.
 * These are optional hints about tool behavior for UX purposes.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/server/tools
 */
export interface ToolAnnotations {
  /** Human-readable title for the tool, shown in UI while executing */
  title?: string;
  /** If true, the tool does not modify its environment (default: false) */
  readOnlyHint?: boolean;
  /** If true, the tool may perform destructive updates and requires confirmation (default: false) */
  destructiveHint?: boolean;
  /** If true, calling repeatedly with same args has no additional effect (default: false) */
  idempotentHint?: boolean;
  /** If true, tool interacts with external/unpredictable entities (default: true) */
  openWorldHint?: boolean;
}

export interface ToolOptions {
  annotations?: ToolAnnotations;
}
```

**Remove `confirmationRequired`**: Update `_toToolDefinition()` to use `destructiveHint` instead:

```typescript
// In _toToolDefinition()
if (this._options.annotations?.destructiveHint) {
  toolDef.confirmationRequired = true;
}
```

### 2. strings.ts - Add Fallback Messages

```typescript
export const defaultStrings = {
  // ... existing categories ...

  toolExecution: {
    /** Fallback messages when no tool title is provided (one randomly selected) */
    fallbackMessages: ['Working...', 'Processing...', 'Doing...'],
  },
};
```

### 3. UseAIChat.tsx - Extend Context Interface

```typescript
export interface ChatUIContextValue {
  // ... existing properties ...

  /** Currently executing tool info for status display */
  executingTool: { displayText: string } | null;
}
```

### 4. useAIProvider.tsx - Track and Expose Executing Tool

Add state:
```typescript
const [executingTool, setExecutingTool] = useState<{
  toolCallId: string;
  title: string | null;
} | null>(null);
const executingToolFallbackRef = useRef<string | null>(null);
```

Handle TOOL_CALL_START event (add new handler before existing TOOL_CALL_END):
```typescript
if (event.type === EventType.TOOL_CALL_START) {
  const e = event as ToolCallStartEvent;
  const tool = aggregatedToolsRef.current[e.toolCallName];
  const title = tool?._options?.annotations?.title ?? null;

  if (!title) {
    const fallbacks = strings.toolExecution.fallbackMessages;
    executingToolFallbackRef.current = fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  setExecutingTool({ toolCallId: e.toolCallId, title });
}
```

Clear on TOOL_CALL_END (add at start of existing handler):
```typescript
setExecutingTool(prev => prev?.toolCallId === toolCallEnd.toolCallId ? null : prev);
```

Compute display value and add to context:
```typescript
const executingToolDisplay = executingTool ? {
  displayText: executingTool.title ?? executingToolFallbackRef.current ?? strings.toolExecution.fallbackMessages[0],
} : null;

const chatUIContextValue: ChatUIContextValue = {
  // ... existing ...
  executingTool: executingToolDisplay,
};
```

Also pass to chatPanelProps (direct rendering case).

### 5. UseAIChatPanel.tsx - Display Tool Status in Input Field

Add prop:
```typescript
export interface UseAIChatPanelProps {
  // ... existing ...
  executingTool?: { displayText: string } | null;
}
```

Update textarea placeholder to show status while loading:
```typescript
<textarea
  placeholder={
    !connected
      ? strings.input.connectingPlaceholder
      : loading
        ? (executingTool?.displayText ?? `${strings.input.thinking}...`)
        : strings.input.placeholder
  }
  disabled={!connected || loading}
  // ...
/>
```

Update loading indicator bubble to only show streaming text:
```typescript
{streamingText ? (
  <MarkdownContent content={streamingText} />
) : (
  <span className="dots" style={{ opacity: 0.6 }}>...</span>
)}
```

### 6. Wire through UseAIChat.tsx

Add to `chatPanelProps`:
```typescript
executingTool: ctx.executingTool,
```

## Display Logic

**Input field placeholder** (while loading):
1. If `executingTool` exists -> show tool title or fallback message
2. Else -> show `"Thinking..."`

**Loading bubble**:
1. If `streamingText` exists -> show streaming response
2. Else -> show `"..."` (minimal indicator)

## Usage Example

```typescript
// With title annotation - shows "Search Appointments..."
const searchAppointments = defineTool(
  'Search for appointments',
  z.object({ query: z.string() }),
  async (input) => searchAPI(input.query),
  {
    annotations: {
      title: 'Search Appointments',  // Shown in UI while executing
      readOnlyHint: true,            // Other MCP hints are optional
    },
  }
);

// Without title - shows random fallback like "Working..."
const doSomething = defineTool('Do something', () => { /* ... */ });

// Destructive tool with confirmation
const deleteUser = defineTool(
  'Delete a user from the database',
  z.object({ userId: z.string() }),
  async (input) => deleteUserAPI(input.userId),
  {
    annotations: {
      title: 'Delete User',
      destructiveHint: true,  // Triggers confirmation prompt
    },
  }
);
```

Custom fallback messages:
```tsx
<UseAIProvider
  serverUrl="ws://localhost:8081"
  strings={{
    toolExecution: {
      fallbackMessages: ['On it...', 'Just a moment...'],
    },
  }}
>
```

## Breaking Changes

- `confirmationRequired` option removed from `ToolOptions`
- Use `annotations.destructiveHint: true` instead

## Verification

1. Build: `bun run build:client`
2. Run example app: `bun run start:server` then `bun run dev`
3. Test with a tool that has `annotations.title` - should show the title
4. Test with a tool without annotations - should show random fallback
5. Verify status clears after tool completes
6. Run existing tests: `bun run test`
7. Verify `annotations.destructiveHint` triggers confirmation
