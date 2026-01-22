# Plan: Programmatic Chat Invocation via `sendMessage`

## Overview

Add the capability for application code to programmatically send messages to the useAI chat panel, enabling webapps to trigger AI conversations through code rather than only through user interaction with the chat UI.

## Requirements

1. A `sendMessage` function accessible via `useAIContext()`
2. Support for optionally starting a new chat or continuing the existing chat
3. Support for file uploads/attachments
4. New example tab demonstrating the feature

## Current Architecture

### Message Flow (existing)

```
UseAIChatPanel (user types)
  → onSendMessage(input, attachments) prop
    → UseAIProvider.handleSendMessage(message, attachments)
      → FileUploadBackend.prepareForSend()
      → client.sendPrompt(message, multimodalContent)
```

### Relevant Files

| File                                              | Purpose                                    |
| ------------------------------------------------- | ------------------------------------------ |
| `packages/client/src/providers/useAIProvider.tsx` | Main provider with `handleSendMessage`     |
| `packages/client/src/hooks/useAIContext.ts`       | Public hook exposing context               |
| `packages/client/src/fileUpload/types.ts`         | `FileAttachment` and backend types         |
| `apps/example/src/App.tsx`                        | Example app with tab navigation            |

## Implementation Plan

### 1. Define the `sendMessage` API

Add to `UseAIContextValue` in `packages/client/src/providers/useAIProvider.tsx`:

```typescript
interface SendMessageOptions {
  /** Start a new chat before sending. Default: false (continue existing chat) */
  newChat?: boolean;
  /** File attachments to include with the message */
  attachments?: File[];
  /** Open the chat panel after sending. Default: true */
  openChat?: boolean;
}

interface UseAIContextValue {
  // ... existing fields

  /**
   * Programmatically send a message to the chat.
   * Returns a promise that resolves when the message is sent (not when response completes).
   */
  sendMessage: (message: string, options?: SendMessageOptions) => Promise<void>;
}
```

### 2. Implement `sendMessage` in UseAIProvider

Location: `packages/client/src/providers/useAIProvider.tsx`

The implementation will:

1. Optionally create a new chat if `newChat: true`
2. Convert `File[]` to `FileAttachment[]` (generate IDs and previews)
3. Call the existing `handleSendMessage` with the message and attachments
4. Optionally open the chat panel

```typescript
const sendMessage = useCallback(async (message: string, options?: SendMessageOptions) => {
  const { newChat = false, attachments = [], openChat = true } = options ?? {};

  // 1. Optionally create new chat
  if (newChat) {
    await handleChatCreate();
  }

  // 2. Convert File[] to FileAttachment[]
  const fileAttachments = await Promise.all(
    attachments.map(async (file) => ({
      id: crypto.randomUUID(),
      file,
      preview: file.type.startsWith('image/') ? await readFileAsDataUrl(file) : undefined,
    }))
  );

  // 3. Send the message
  await handleSendMessage(message, fileAttachments);

  // 4. Open chat panel
  if (openChat) {
    setOpen(true);
  }
}, [handleChatCreate, handleSendMessage, setOpen]);
```

### 3. Export from Public API

Location: `packages/client/src/hooks/useAIContext.ts`

The `sendMessage` function should be accessible via the existing `useAIContext()` hook:

```typescript
const { sendMessage, createNewChat, currentChatId } = useAIContext();

// Simple usage
await sendMessage('Hello, AI!');

// Start new chat
await sendMessage('Start fresh', { newChat: true });

// With file attachment
await sendMessage('Analyze this image', {
  attachments: [imageFile],
  openChat: false  // Don't open panel
});
```

### 4. Create Example Tab

Location: `apps/example/src/pages/ProgrammaticChatPage.tsx`

```typescript
export function ProgrammaticChatPage() {
  const { sendMessage } = useAIContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  return (
    <div>
      <h2>Programmatic Chat Demo</h2>

      {/* Preset message buttons */}
      <section>
        <h3>Send Preset Messages</h3>
        <button onClick={() => sendMessage('What can you help me with?')}>
          Ask capabilities
        </button>
        <button onClick={() => sendMessage('Tell me a joke')}>
          Tell a joke
        </button>
        <button onClick={() => sendMessage('Start a new conversation', { newChat: true })}>
          New chat + greeting
        </button>
      </section>

      {/* File upload section */}
      <section>
        <h3>Send with Attachment</h3>
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
        />
        {selectedFile && (
          <button onClick={() => {
            sendMessage('Please analyze this file', { attachments: [selectedFile] });
            setSelectedFile(null);
          }}>
            Send with file
          </button>
        )}
      </section>
    </div>
  );
}
```

### 5. Add Tab to Example App

Location: `apps/example/src/App.tsx`

Add new tab entry to the navigation:

```typescript
const TABS = [
  // ... existing tabs
  { id: 'programmatic-chat', label: 'Programmatic Chat' },
];

// In router
<Route path="programmatic-chat">
  <ProgrammaticChatPage />
</Route>
```

## File Changes Summary

| File                                              | Change                                  |
| ------------------------------------------------- | --------------------------------------- |
| `packages/client/src/providers/useAIProvider.tsx` | Add `sendMessage` to context and impl   |
| `packages/client/src/index.ts`                    | Export `SendMessageOptions` type        |
| `apps/example/src/pages/ProgrammaticChatPage.tsx` | New file - demo page                    |
| `apps/example/src/App.tsx`                        | Add tab and route                       |

## Edge Cases to Handle

1. **No active connection**: Return error or queue message until connected
2. **Currently loading**: Either queue the message or reject with error
3. **Invalid attachments**: Validate file size/type before sending
4. **Chat panel closed**: The `openChat` option controls whether to open it

## Testing Plan

### Unit Tests

- `sendMessage` creates new chat when `newChat: true`
- `sendMessage` converts `File[]` to `FileAttachment[]` correctly
- `sendMessage` opens chat panel when `openChat: true` (default)
- `sendMessage` does not open chat panel when `openChat: false`

### E2E Tests

Location: `apps/example/test/programmatic-chat.e2e.test.ts`

- Click "Ask capabilities" button → message appears in chat
- Click "New chat + greeting" → new chat created, message sent
- Select file + click "Send with file" → message with attachment sent

## Open Questions

1. **Error handling**: Should `sendMessage` throw on failure or return a result object?
   - Recommendation: Throw on failure (consistent with async patterns)
   > TODO: throw

2. **Return value**: Should it return anything useful (e.g., message ID, promise that resolves when AI responds)?
   - Recommendation: Return `Promise<void>` for v1, can extend later
   > TODO: Promise<void>

3. **Queue behavior**: What happens if called while AI is still responding?
   - Recommendation: Queue the message (same as typing in chat while loading)
   > TODO: queue