# Plan: Tool Confirmation v3 - Native UI Approval

## Problem Statement

The current confirmation mechanism for destructive tools is brittle and unreliable:

1. **Current approach**: Inject prompt fragments into the system prompt asking the AI to confirm before executing destructive tools
2. **Why it fails**: The AI may ignore, forget, or misinterpret the instructions, especially in complex conversations
3. **No UI feedback**: Users don't see a clear confirmation dialog - the AI just asks in chat text

## Goals

1. Use `tool.annotations.destructiveHint` to identify tools requiring confirmation (MCP-aligned)
2. Use AI SDK's native `needsApproval` capability to block tool execution until approved
3. Display a clear confirmation UI element in the chat when approval is needed
4. Support both frontend-defined tools and MCP tools

## AI SDK `needsApproval` Capability

The AI SDK provides a `needsApproval` option on tool definitions that:
- Prevents automatic tool execution when `needsApproval` returns `true`
- Emits a `tool-approval-request` chunk in the stream
- Waits for external approval before proceeding

```typescript
// AI SDK tool definition with needsApproval
{
  description: 'Delete a user',
  inputSchema: jsonSchema({ type: 'object', properties: { userId: { type: 'string' } } }),
  needsApproval: true, // or (args) => args.dangerous === true
  execute: async (args) => { /* ... */ },
}
```

## Architecture Overview

```
1. Tool defined with annotations.destructiveHint: true
2. Server converts to AI SDK tool with needsApproval: true
3. AI decides to call the tool
4. AI SDK emits tool-approval-request (instead of executing)
5. Server emits TOOL_APPROVAL_REQUEST event to client
6. Client shows confirmation UI
7. User approves/rejects
8. Client sends tool_approval_response to server
9. Server resumes/cancels stream accordingly
```

## Files to Modify

| File                                                | Change                                                    |
| --------------------------------------------------- | --------------------------------------------------------- |
| `packages/core/src/types.ts`                        | Add `TOOL_APPROVAL_REQUEST` event type                    |
| `packages/server/src/server.ts`                     | Remove prompt-based confirmation logic                    |
| `packages/server/src/agents/AISDKAgent.ts`          | Add `needsApproval` to tools, handle approval flow        |
| `packages/server/src/types.ts`                      | Add approval request/response message types               |
| `packages/client/src/providers/useAIProvider.tsx`   | Handle approval events, expose approval state             |
| `packages/client/src/components/UseAIChatPanel.tsx` | Add confirmation UI component                             |
| `packages/client/src/components/UseAIChat.tsx`      | Add approval state to context                             |

## Implementation Details

### 1. Core Types (`packages/core/src/types.ts`)

Add new event type for tool approval requests:

```typescript
export enum EventType {
  // ... existing types ...
  TOOL_APPROVAL_REQUEST = 'TOOL_APPROVAL_REQUEST',
}

/**
 * Event emitted when a tool requires user approval before execution.
 */
export interface ToolApprovalRequestEvent extends BaseEvent {
  type: EventType.TOOL_APPROVAL_REQUEST;
  /** Unique ID for this tool call */
  toolCallId: string;
  /** Name of the tool requesting approval */
  toolCallName: string;
  /** Arguments the tool will be called with */
  toolCallArgs: Record<string, unknown>;
  /** Tool annotations for UI display */
  annotations?: ToolAnnotations;
}
```

### 2. Server Types (`packages/server/src/types.ts`)

Add message types for the approval response:

```typescript
/**
 * Client sends this to approve/reject a tool execution.
 */
export interface ToolApprovalResponseMessage {
  type: 'tool_approval_response';
  data: {
    toolCallId: string;
    approved: boolean;
    /** Optional reason for rejection (shown to AI) */
    reason?: string;
  };
}
```

### 3. Remove Prompt Injection (`packages/server/src/server.ts`)

Remove the brittle prompt-based confirmation from `buildSystemPrompt()`:

```typescript
private buildSystemPrompt(session: ClientSession, state: unknown): string | undefined {
  const parts: string[] = [];

  // Add state context if available
  if (state) {
    parts.push('You are interacting with a web application. Here is the current state:');
    parts.push('');
    parts.push(JSON.stringify(state, null, 2));
    parts.push('');
    parts.push('Use the available tools to interact with and modify the UI based on user requests.');
  }

  // REMOVED: Prompt-based confirmation logic
  // Confirmation is now handled natively via AI SDK's needsApproval

  return parts.length > 0 ? parts.join('\n') : undefined;
}
```

Add handler for approval responses:

```typescript
private setupClientSocket(socket: Socket, session: ClientSession) {
  // ... existing handlers ...

  socket.on('tool_approval_response', (message: ToolApprovalResponseMessage) => {
    this.handleToolApprovalResponse(session, message);
  });
}

private handleToolApprovalResponse(session: ClientSession, message: ToolApprovalResponseMessage) {
  const { toolCallId, approved, reason } = message.data;
  const resolver = session.pendingApprovals.get(toolCallId);

  if (resolver) {
    resolver({ approved, reason });
    session.pendingApprovals.delete(toolCallId);
  }
}
```

Add pending approvals map to ClientSession:

```typescript
interface ClientSession {
  // ... existing fields ...
  pendingApprovals: Map<string, (result: { approved: boolean; reason?: string }) => void>;
}
```

### 4. AISDKAgent Changes (`packages/server/src/agents/AISDKAgent.ts`)

#### 4.1 Add `needsApproval` to Tool Definitions

```typescript
private sanitizeToolsForAPI(
  tools: ToolDefinition[],
  session: ClientSession,
  events: EventEmitter
): Record<string, unknown> {
  const toolsObject: Record<string, unknown> = {};
  const clientToolExecutor = createClientToolExecutor(session);

  for (const toolDef of tools) {
    const rawParams = toolDef.parameters;
    const inputSchema = rawParams && typeof rawParams === 'object'
      ? { ...rawParams, type: ((rawParams as Record<string, unknown>).type || 'object') as 'object' }
      : { type: 'object' as const, properties: {} };

    // Determine if tool needs approval based on destructiveHint
    const needsApproval = this.toolNeedsApproval(toolDef);

    toolsObject[toolDef.name] = {
      description: toolDef.description,
      inputSchema: jsonSchema(inputSchema as JSONSchema7),
      needsApproval,
      execute: this.isRemoteTool(toolDef)
        ? this.createMcpToolExecutor(toolDef, session)
        : clientToolExecutor,
    };
  }

  return toolsObject;
}

/**
 * Determines if a tool needs user approval before execution.
 * Uses annotations.destructiveHint from both frontend and MCP tools.
 */
private toolNeedsApproval(toolDef: ToolDefinition): boolean {
  // Check frontend tool annotations
  if (toolDef.annotations?.destructiveHint) {
    return true;
  }

  // Check MCP tool annotations (stored in _remote.annotations)
  if (this.isRemoteTool(toolDef)) {
    return toolDef._remote.annotations?.destructiveHint === true;
  }

  return false;
}
```

#### 4.2 Handle `tool-approval-request` Stream Chunk

Add handling in the stream processing loop:

```typescript
for await (const chunk of stream.fullStream) {
  switch (chunk.type) {
    // ... existing cases ...

    case 'tool-approval-request': {
      // Tool needs user approval before execution
      const toolDef = tools.find(t => t.name === chunk.toolName);
      const annotations = toolDef?.annotations ??
        (this.isRemoteTool(toolDef) ? toolDef._remote.annotations : undefined);

      // Emit approval request event to client
      events.emit<ToolApprovalRequestEvent>({
        type: EventType.TOOL_APPROVAL_REQUEST,
        toolCallId: chunk.toolCallId,
        toolCallName: chunk.toolName,
        toolCallArgs: chunk.toolCallArgs,
        annotations,
        timestamp: Date.now(),
      });

      // Wait for approval from client
      const approvalResult = await this.waitForApproval(session, chunk.toolCallId);

      if (approvalResult.approved) {
        // Resume execution - AI SDK will continue with the tool call
        // The stream continues automatically after approval
      } else {
        // Reject - need to handle stream cancellation
        // Return a tool result indicating rejection
        // This allows the AI to respond appropriately
      }
      break;
    }
  }
}
```

#### 4.3 Approval Waiting Mechanism

```typescript
private waitForApproval(
  session: ClientSession,
  toolCallId: string
): Promise<{ approved: boolean; reason?: string }> {
  return new Promise((resolve) => {
    session.pendingApprovals.set(toolCallId, resolve);
  });
}
```

### 5. Client Provider (`packages/client/src/providers/useAIProvider.tsx`)

Add state and handlers for approval flow:

```typescript
// State for pending approval
const [pendingApproval, setPendingApproval] = useState<{
  toolCallId: string;
  toolCallName: string;
  toolCallArgs: Record<string, unknown>;
  annotations?: ToolAnnotations;
} | null>(null);

// Handle TOOL_APPROVAL_REQUEST event
if (event.type === EventType.TOOL_APPROVAL_REQUEST) {
  const e = event as ToolApprovalRequestEvent;
  setPendingApproval({
    toolCallId: e.toolCallId,
    toolCallName: e.toolCallName,
    toolCallArgs: e.toolCallArgs,
    annotations: e.annotations,
  });
}

// Approval response function
const respondToApproval = useCallback((approved: boolean, reason?: string) => {
  if (!pendingApproval || !socketRef.current) return;

  socketRef.current.emit('tool_approval_response', {
    type: 'tool_approval_response',
    data: {
      toolCallId: pendingApproval.toolCallId,
      approved,
      reason,
    },
  });

  setPendingApproval(null);
}, [pendingApproval]);

// Add to context
const chatUIContextValue: ChatUIContextValue = {
  // ... existing ...
  pendingApproval,
  approveToolCall: () => respondToApproval(true),
  rejectToolCall: (reason?: string) => respondToApproval(false, reason),
};
```

### 6. Chat Context Types (`packages/client/src/components/UseAIChat.tsx`)

Extend the context interface:

```typescript
export interface ChatUIContextValue {
  // ... existing properties ...

  /** Pending tool approval request, if any */
  pendingApproval: {
    toolCallId: string;
    toolCallName: string;
    toolCallArgs: Record<string, unknown>;
    annotations?: ToolAnnotations;
  } | null;

  /** Approve the pending tool call */
  approveToolCall: () => void;

  /** Reject the pending tool call with optional reason */
  rejectToolCall: (reason?: string) => void;
}
```

### 7. Confirmation UI (`packages/client/src/components/UseAIChatPanel.tsx`)

Add a confirmation dialog component that appears in the chat when approval is needed:

```typescript
interface ToolApprovalDialogProps {
  toolCallName: string;
  toolCallArgs: Record<string, unknown>;
  annotations?: ToolAnnotations;
  onApprove: () => void;
  onReject: (reason?: string) => void;
}

function ToolApprovalDialog({
  toolCallName,
  toolCallArgs,
  annotations,
  onApprove,
  onReject,
}: ToolApprovalDialogProps) {
  const theme = useTheme();
  const strings = useStrings();

  const displayName = annotations?.title || toolCallName;

  return (
    <div
      data-testid="tool-approval-dialog"
      style={{
        padding: '16px',
        margin: '8px 0',
        borderRadius: '12px',
        background: theme.assistantMessageBackground,
        border: `2px solid ${theme.warningColor}`,
      }}
    >
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontWeight: 600, marginBottom: '4px' }}>
          {strings.toolApproval.title}
        </div>
        <div style={{ fontSize: '14px', color: theme.secondaryTextColor }}>
          {strings.toolApproval.message.replace('{toolName}', displayName)}
        </div>
      </div>

      {/* Show tool arguments in a collapsible section */}
      <details style={{ marginBottom: '12px' }}>
        <summary style={{ cursor: 'pointer', fontSize: '13px', color: theme.secondaryTextColor }}>
          {strings.toolApproval.showDetails}
        </summary>
        <pre style={{
          marginTop: '8px',
          padding: '8px',
          background: theme.codeBackground,
          borderRadius: '6px',
          fontSize: '12px',
          overflow: 'auto',
          maxHeight: '150px',
        }}>
          {JSON.stringify(toolCallArgs, null, 2)}
        </pre>
      </details>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          data-testid="approve-tool-button"
          onClick={onApprove}
          style={{
            flex: 1,
            padding: '10px 16px',
            borderRadius: '8px',
            border: 'none',
            background: theme.primaryColor,
            color: 'white',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {strings.toolApproval.approve}
        </button>
        <button
          data-testid="reject-tool-button"
          onClick={() => onReject()}
          style={{
            flex: 1,
            padding: '10px 16px',
            borderRadius: '8px',
            border: `1px solid ${theme.borderColor}`,
            background: 'transparent',
            color: theme.textColor,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {strings.toolApproval.reject}
        </button>
      </div>
    </div>
  );
}
```

Render in the chat panel when pending approval exists:

```typescript
{/* Messages */}
<div style={{ /* ... */ }}>
  {messages.map((message) => (/* ... */))}

  {/* Tool approval dialog */}
  {pendingApproval && (
    <ToolApprovalDialog
      toolCallName={pendingApproval.toolCallName}
      toolCallArgs={pendingApproval.toolCallArgs}
      annotations={pendingApproval.annotations}
      onApprove={approveToolCall}
      onReject={rejectToolCall}
    />
  )}

  {loading && !pendingApproval && (/* loading indicator */)}
</div>
```

### 8. Strings (`packages/client/src/theme/strings.ts`)

Add confirmation dialog strings:

```typescript
export const defaultStrings = {
  // ... existing ...

  toolApproval: {
    /** Title shown in the approval dialog */
    title: 'Confirmation Required',
    /** Message shown in the approval dialog. {toolName} is replaced with tool name. */
    message: 'The AI wants to execute "{toolName}". Do you want to proceed?',
    /** Label for approve button */
    approve: 'Allow',
    /** Label for reject button */
    reject: 'Deny',
    /** Label for showing tool arguments */
    showDetails: 'Show details',
  },
};
```

## AI SDK Integration Details

### How `needsApproval` Works

The AI SDK's `needsApproval` feature:

1. Can be a boolean (`true`) or a function `(args) => boolean`
2. When `true` (or function returns `true`), the stream emits `tool-approval-request` instead of executing
3. The stream pauses until the approval is provided
4. Use the stream's approval methods to resume or reject

### Stream Approval API

The AI SDK provides methods on the stream result to handle approvals:

```typescript
const stream = streamText({
  // ...
  tools: {
    deleteTodo: {
      description: 'Delete a todo',
      needsApproval: true,
      execute: async (args) => { /* ... */ },
    },
  },
});

// When tool-approval-request is received, you can:
// Option 1: Approve the tool call
await stream.submitToolApproval(toolCallId);

// Option 2: Reject with a message (AI sees this)
await stream.rejectToolCall(toolCallId, 'User denied the action');
```

### Alternative: Manual Approval via Tool Result

If the AI SDK doesn't expose direct approval methods, we can simulate rejection by returning an error tool result:

```typescript
case 'tool-approval-request': {
  const approvalResult = await this.waitForApproval(session, chunk.toolCallId);

  if (!approvalResult.approved) {
    // The tool execute function needs to check approval status
    // We can track rejected tool calls and return error in execute
    session.rejectedToolCalls.add(chunk.toolCallId);
  }
  break;
}

// In execute function:
execute: async (args, { toolCallId }) => {
  if (session.rejectedToolCalls.has(toolCallId)) {
    session.rejectedToolCalls.delete(toolCallId);
    return { error: 'User denied this action', denied: true };
  }
  // Normal execution...
}
```

## Data Flow Diagram

```
Frontend Tool Definition                  MCP Tool
         │                                    │
         ▼                                    ▼
annotations.destructiveHint: true    _remote.annotations.destructiveHint: true
         │                                    │
         └──────────────┬─────────────────────┘
                        ▼
            Server: sanitizeToolsForAPI()
                        │
                        ▼
            needsApproval: true added
                        │
                        ▼
            AI SDK streamText() called
                        │
                        ▼
            AI decides to call tool
                        │
                        ▼
         ┌──────────────┴──────────────┐
         │  needsApproval = false      │  needsApproval = true
         ▼                             ▼
    tool-call chunk              tool-approval-request
         │                             │
         ▼                             ▼
    Execute immediately         Server: Emit TOOL_APPROVAL_REQUEST
                                       │
                                       ▼
                               Client: Show UI dialog
                                       │
                               ┌───────┴───────┐
                               ▼               ▼
                           Approve          Reject
                               │               │
                               ▼               ▼
                      Continue stream   Return error result
                               │               │
                               ▼               ▼
                         Execute tool   AI responds to rejection
```

## Testing Strategy

### Unit Tests

1. `AISDKAgent.test.ts`:
   - Test `toolNeedsApproval()` with frontend tools
   - Test `toolNeedsApproval()` with MCP tools
   - Test approval flow with mocked stream

2. `defineTool.test.ts`:
   - Verify `destructiveHint` is passed through annotations

### Integration Tests

1. `approval.integration.test.ts`:
   - Test full approval flow with frontend tool
   - Test full approval flow with MCP tool
   - Test rejection returns appropriate error
   - Test approval timeout handling

### E2E Tests

1. `tool-approval.e2e.test.ts`:
   - Visual test: approval dialog appears
   - Test: clicking approve executes tool
   - Test: clicking deny cancels tool
   - Test: multiple pending approvals handled correctly

## Migration Guide

### For Users

```typescript
// Before (v2)
const deleteTodo = defineTool(
  'Delete a todo',
  z.object({ id: z.string() }),
  (input) => deleteTodoFn(input.id),
  { confirmationRequired: true }  // OLD - will stop working
);

// After (v3)
const deleteTodo = defineTool(
  'Delete a todo',
  z.object({ id: z.string() }),
  (input) => deleteTodoFn(input.id),
  { annotations: { destructiveHint: true } }  // NEW - MCP aligned
);
```

### Breaking Changes

1. `confirmationRequired` option removed (was deprecated in status-texts plan)
2. AI no longer asks for confirmation in chat text
3. Confirmation is now via UI dialog
4. User must click button to approve (no more chat-based "yes")

## Edge Cases

1. **User closes chat during approval**: Treat as rejection after timeout
2. **Socket disconnect during approval**: Treat as rejection, AI sees connection error
3. **Multiple tool calls needing approval**: Show one at a time, queue others
4. **Tool approval timeout**: Add configurable timeout, default 5 minutes
5. **Abort run during approval**: Clear pending approval, cancel stream

## Future Enhancements

1. **Batch approval**: "Allow all similar actions this session"
2. **Approval persistence**: Remember approval for specific tools
3. **Custom approval UI**: Allow apps to provide custom confirmation dialogs
4. **Approval reasons**: Let users provide context when rejecting

## Verification Checklist

1. [ ] Build: `bun run build`
2. [ ] Unit tests pass: `bun run test`
3. [ ] E2E tests pass: `bun run test:e2e`
4. [ ] Manual test: Create destructive tool, verify dialog appears
5. [ ] Manual test: Click approve, verify tool executes
6. [ ] Manual test: Click deny, verify AI responds appropriately
7. [ ] Manual test: MCP tool with destructiveHint shows dialog
8. [ ] Verify no prompt injection in system prompt
