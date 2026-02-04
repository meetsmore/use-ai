# User Feedback Feature (Langfuse Integration)

## Overview

Add thumbs up/down feedback buttons on AI messages in the chat UI. When pressed, feedback is persisted locally and sent to Langfuse for observability.

## Requirements

1. Show thumbs up/down icons on assistant messages when Langfuse is configured
2. Pressing a button should:
   a. Persist the feedback state locally (so it shows on page reload)
   b. Send the feedback to Langfuse as a score

## Langfuse Scores API

> TODO: We shouldn't do x we should y, check this link etc etc

From [Langfuse documentation](https://langfuse.com/docs/observability/features/user-feedback):

```typescript
// Server-side (Node.js)
import Langfuse from 'langfuse';

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
});

langfuse.score({
  traceId: '<trace-id>',           // Links feedback to specific trace
  name: 'user-feedback',           // Score category
  value: 1,                        // 1 = thumbs up, 0 = thumbs down
  comment: 'optional comment',     // Optional context
  id: '<idempotency-key>',         // Prevents duplicate scores
});
```

Key points:
- Scores are attached to traces via `traceId`
- Use idempotency key (`id`) to allow toggling/updating feedback
- Value: `1` for positive, `0` for negative

## Architecture Decision: Server-Routed Feedback

**Why route through server instead of using LangfuseWeb SDK:**
1. Server already has Langfuse credentials (secret key stays server-side)
2. Consistent with existing observability setup in `AISDKAgent`
3. Client doesn't need additional configuration
4. Can conditionally enable based on server's Langfuse config

## Key Challenge: Linking Messages to Traces

> TODO: Check how langfuse is already configured, is this OUR `runId`, or should it be a Langfuse trace ID? and if it's a langfuse trace ID, how do we get it?

The `runId` from `RUN_FINISHED` event corresponds to a Langfuse trace. We need to:
1. Capture `runId` when a run finishes
2. Associate it with the assistant message created during that run
3. Send `runId` as `traceId` when submitting feedback

Current state (from `packages/client/src/client.ts:250-270`):
- `RUN_FINISHED` event is handled but `runId` is not captured
- Assistant message is created with its own `id` but not linked to `runId`

## Implementation Plan

### Phase 1: Core Protocol Changes

#### 1.1 Add feedback message type to core (`packages/core/src/types.ts`)

```typescript
// Add to UseAIClientMessage type union
export type UseAIClientMessage =
  | ClientMessage
  | RunWorkflowMessage
  | FeedbackMessage;  // New

export interface FeedbackMessage {
  type: 'message_feedback';
  data: {
    messageId: string;      // Client message ID
    traceId: string;        // Langfuse trace ID (runId)
    feedback: 'up' | 'down' | null;  // null = remove feedback
  };
}
```

#### 1.2 Extend PersistedMessage type (`packages/client/src/providers/chatRepository/types.ts`)

```typescript
export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: PersistedMessageContent;
  createdAt: Date;
  displayMode?: MessageDisplayMode;
  traceId?: string;           // New: Langfuse trace ID for feedback
  feedback?: 'up' | 'down';   // New: Current feedback state
}
```

### Phase 2: Client Changes

#### 2.1 Capture runId and associate with messages (`packages/client/src/client.ts`)

In `handleEvent` for `RUN_FINISHED`:
```typescript
else if (event.type === EventType.RUN_FINISHED) {
  const e = event as RunFinishedEvent;

  if (this._currentAssistantMessage) {
    const assistantMessage: AssistantMessageWithTools = {
      id: this._currentAssistantMessage.id!,
      role: 'assistant',
      content: this._currentAssistantMessage.content || '',
      traceId: e.runId,  // New: capture trace ID
    };
    // ... rest unchanged
  }
}
```

#### 2.2 Add feedback submission method to UseAIClient (`packages/client/src/client.ts`)

```typescript
/**
 * Submits feedback for an assistant message.
 * Sends to server which forwards to Langfuse.
 */
submitFeedback(messageId: string, traceId: string, feedback: 'up' | 'down' | null): void {
  if (!this.socket.connected) return;

  this.socket.emit('message', {
    type: 'message_feedback',
    data: { messageId, traceId, feedback },
  });
}
```

#### 2.3 Update chat panel UI (`packages/client/src/components/UseAIChatPanel.tsx`)

Add feedback buttons to assistant messages (using existing hover pattern):

```typescript
// Inside message render loop, for assistant messages:
{message.role === 'assistant' && message.traceId && (
  <div className="feedback-buttons" style={{ display: 'flex', gap: '4px' }}>
    <button
      data-testid="feedback-up"
      onClick={() => handleFeedback(message.id, message.traceId!, 'up')}
      style={{
        opacity: message.feedback === 'up' ? 1 : 0.5,
        // ... styling
      }}
    >
      <ThumbsUpIcon />
    </button>
    <button
      data-testid="feedback-down"
      onClick={() => handleFeedback(message.id, message.traceId!, 'down')}
      style={{
        opacity: message.feedback === 'down' ? 1 : 0.5,
        // ... styling
      }}
    >
      <ThumbsDownIcon />
    </button>
  </div>
)}
```

Handler:
```typescript
const handleFeedback = async (messageId: string, traceId: string, feedback: 'up' | 'down') => {
  // Toggle: if same feedback clicked, remove it
  const newFeedback = message.feedback === feedback ? null : feedback;

  // 1. Update local state
  updateMessageFeedback(messageId, newFeedback);

  // 2. Send to server
  client.submitFeedback(messageId, traceId, newFeedback);

  // 3. Persist to chat repository
  await persistFeedback(messageId, newFeedback);
};
```

#### 2.4 Add config prop for enabling feedback

```typescript
// UseAIProvider props
interface UseAIProviderProps {
  // ... existing props
  enableFeedback?: boolean;  // Default: true when Langfuse configured
}
```

Server should emit its Langfuse status on connect so client knows whether to show feedback UI.

### Phase 3: Server Changes

#### 3.1 Add Langfuse SDK dependency

```bash
bun add langfuse  # packages/server
```

#### 3.2 Create feedback handler (`packages/server/src/handlers/feedbackHandler.ts`)

```typescript
import Langfuse from 'langfuse';
import type { FeedbackMessage } from '@meetsmore-oss/use-ai-core';

let langfuseClient: Langfuse | null = null;

export function initFeedbackHandler(): boolean {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    return false;
  }

  langfuseClient = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
  });

  return true;
}

export async function handleFeedback(data: FeedbackMessage['data']): Promise<void> {
  if (!langfuseClient) return;

  const { messageId, traceId, feedback } = data;

  if (feedback === null) {
    // Remove feedback - Langfuse doesn't support deletion,
    // so we can either skip or set to a neutral value
    return;
  }

  await langfuseClient.score({
    traceId,
    name: 'user-feedback',
    value: feedback === 'up' ? 1 : 0,
    id: `${traceId}-user-feedback`,  // Idempotency key allows updates
  });
}
```

#### 3.3 Register handler in server (`packages/server/src/server.ts`)

```typescript
// In constructor or setup
const langfuseEnabled = initFeedbackHandler();

// Register message handler
this.registerMessageHandler('message_feedback', async (socket, message) => {
  if (!langfuseEnabled) return;
  await handleFeedback(message.data);
});

// Emit Langfuse status on connect
socket.on('connect', () => {
  socket.emit('config', { langfuseEnabled });
});
```

### Phase 4: Chat Persistence

#### 4.1 Update LocalStorageChatRepository

Ensure `feedback` and `traceId` fields are persisted/loaded correctly. The existing implementation should handle this automatically since it stores the full message object.

#### 4.2 Update message type in chat panel

The `Message` interface in `UseAIChatPanel.tsx` needs to include optional `traceId` and `feedback` fields.

## File Changes Summary

| Package | File | Changes |
|---------|------|---------|
| core | `src/types.ts` | Add `FeedbackMessage` type |
| client | `src/providers/chatRepository/types.ts` | Add `traceId`, `feedback` to `PersistedMessage` |
| client | `src/client.ts` | Capture `runId`, add `submitFeedback()` method |
| client | `src/components/UseAIChatPanel.tsx` | Add feedback buttons UI |
| client | `src/components/icons/` | Add ThumbsUp/ThumbsDown SVG icons |
| client | `src/providers/UseAIProvider.tsx` | Add `enableFeedback` prop, receive server config |
| server | `package.json` | Add `langfuse` dependency |
| server | `src/handlers/feedbackHandler.ts` | New: Langfuse feedback submission |
| server | `src/server.ts` | Register feedback handler, emit config |

## UI/UX Details

### Button Appearance
- Small, subtle icons below/beside assistant message
- Semi-transparent when not selected (opacity 0.5)
- Full opacity when selected
- Theme-aware colors (use existing theme system)

### Button States
- Neither selected: both at 50% opacity
- Thumbs up selected: up at 100%, down at 50%
- Thumbs down selected: down at 100%, up at 50%
- Click selected again: deselect (remove feedback)

### Visibility
- Only show on assistant messages with `traceId` (server must have Langfuse configured)
- Consider: show on hover vs always visible

## Testing Strategy

### Unit Tests
- `client.ts`: Test `submitFeedback` emits correct message
- `feedbackHandler.ts`: Test Langfuse score creation

### E2E Tests (apps/example/test/)
- Test feedback buttons appear when Langfuse configured
- Test feedback persists across page reload
- Test toggle behavior (click same button removes feedback)
- Test feedback sent to server (mock socket)

### Manual Testing
- Verify scores appear in Langfuse dashboard
- Test with Langfuse disabled (buttons should not appear)

## Rollout Considerations

1. **Feature flag**: The `enableFeedback` prop allows opt-out even when Langfuse is configured
2. **Backwards compatibility**: `traceId` and `feedback` are optional fields
3. **Graceful degradation**: If server doesn't support feedback, client should not show buttons

## Future Enhancements

1. **Comment field**: Allow users to add text feedback
2. **Feedback analytics**: Dashboard showing feedback trends
3. **Retry logic**: Queue feedback if server unreachable
4. **Optimistic updates**: Show selection immediately before server confirms
