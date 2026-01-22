# Plan: Chat Metadata

## Overview

Add the ability to store arbitrary metadata on chats that can be retrieved at any time. The primary use case is enabling file transformers to receive chat context (including metadata) so they can make decisions based on how the chat was invoked.

**Example Use Case:**
1. User uploads a PDF
2. Chat is invoked programmatically from an "OCR" button
3. Metadata is set indicating the PDF contains invoice data
4. File transformer for PDFs receives the chat object and switches behavior based on metadata

## Requirements

1. Add `metadata` field to the `Chat` interface (arbitrary key-value store)
2. Provide API to set/get metadata via `useAIContext()`
3. Allow metadata to be set when creating a chat via `CreateChatOptions`
4. Update file transformers to receive the chat object (including metadata)
5. Persist metadata alongside other chat data

## Current Architecture

### Chat Interface (current)

```typescript
interface Chat {
  id: string;
  title?: string;
  messages: PersistedMessage[];
  createdAt: Date;
  updatedAt: Date;
}
```

### File Transformer Interface (from feature/file-transformers)

```typescript
interface FileTransformer {
  transform(file: File, onProgress?: (progress: number) => void): Promise<string>;
}
```

### Relevant Files

| File                                                             | Purpose                                 |
| ---------------------------------------------------------------- | --------------------------------------- |
| `packages/client/src/providers/chatRepository/types.ts`          | `Chat` and `ChatRepository` interfaces  |
| `packages/client/src/providers/chatRepository/localStorage.ts`   | localStorage implementation             |
| `packages/client/src/hooks/useChatManagement.ts`                 | Chat lifecycle management               |
| `packages/client/src/providers/useAIProvider.tsx`                | Main provider exposing context          |
| `packages/client/src/fileUpload/types.ts`                        | `FileTransformer` interface             |
| `packages/client/src/hooks/useFileUpload.tsx`                    | File upload hook (invokes transformers) |

## Implementation Plan

### 1. Add Metadata to Chat Interface

Location: `packages/client/src/providers/chatRepository/types.ts`

```typescript
/**
 * Arbitrary metadata attached to a chat.
 * Use this to store context about the chat (e.g., how it was invoked, document type being processed).
 */
export type ChatMetadata = Record<string, unknown>;

/**
 * Represents a stored chat conversation.
 */
export interface Chat {
  id: string;
  title?: string;
  messages: PersistedMessage[];
  createdAt: Date;
  updatedAt: Date;
  /** Arbitrary metadata attached to the chat */
  metadata?: ChatMetadata;
}
```

### 2. Update CreateChatOptions

Location: `packages/client/src/providers/chatRepository/types.ts`

```typescript
/**
 * Options for creating a new chat.
 */
export interface CreateChatOptions {
  title?: string;
  /** Initial metadata for the chat */
  metadata?: ChatMetadata;
}
```

### 3. Update ChatRepository Interface

Location: `packages/client/src/providers/chatRepository/types.ts`

Add a dedicated method for updating metadata:

> TODO: Add a flag for overwrite which replaces whole metadata object.
> TODO: We also need a way to get the metadata (access readonly object or getMetadata function)

```typescript
interface ChatRepository {
  // ... existing methods

  /**
   * Updates metadata for a chat.
   * Merges with existing metadata (does not replace).
   * @param id Chat ID
   * @param metadata Metadata to merge
   * @returns Promise resolving when update is complete
   */
  updateMetadata(id: string, metadata: ChatMetadata): Promise<void>;
}
```

### 4. Update localStorage Implementation

Location: `packages/client/src/providers/chatRepository/localStorage.ts`

1. Update `createChat` to accept and store initial metadata
2. Implement `updateMetadata` method

```typescript
async createChat(options?: CreateChatOptions): Promise<string> {
  const id = generateChatId();
  const chat: Chat = {
    id,
    title: options?.title,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: options?.metadata,  // NEW
  };
  // ... save to localStorage
  return id;
}

async updateMetadata(id: string, metadata: ChatMetadata): Promise<void> {
  const chat = await this.loadChat(id);
  if (!chat) {
    throw new Error(`Chat not found: ${id}`);
  }
  chat.metadata = { ...chat.metadata, ...metadata };
  chat.updatedAt = new Date();
  await this.saveChat(chat);
}
```

### 5. Update useChatManagement Hook

Location: `packages/client/src/hooks/useChatManagement.ts`

Add functions to get and update metadata:

```typescript
interface UseChatManagementReturn {
  // ... existing fields

  /** Get the current chat object (including metadata) */
  getCurrentChat: () => Promise<Chat | null>;
  /** Update metadata for the current chat */
  updateMetadata: (metadata: ChatMetadata) => Promise<void>;
}
```

Implementation:

```typescript
const getCurrentChat = useCallback(async (): Promise<Chat | null> => {
  const chatId = displayedChatId;
  if (!chatId) return null;
  return repository.loadChat(chatId);
}, [displayedChatId, repository]);

const updateMetadata = useCallback(async (metadata: ChatMetadata): Promise<void> => {
  const chatId = displayedChatId;
  if (!chatId) {
    throw new Error('No active chat');
  }
  await repository.updateMetadata(chatId, metadata);
}, [displayedChatId, repository]);
```

### 6. Expose via useAIContext

Location: `packages/client/src/providers/useAIProvider.tsx`

Update the context value to expose metadata operations:

> TODO: So people dont mutate the metadata object and expect it to be updated, add a `getMetadata` method for the chat.

```typescript
interface UseAIContextValue {
  // ... existing fields
  chat: {
    currentId: string | null;
    create: (options?: CreateChatOptions) => Promise<string>;  // Updated signature
    load: (chatId: string) => Promise<void>;
    delete: (chatId: string) => Promise<void>;
    list: () => Promise<Array<Omit<Chat, 'messages'>>>;
    clear: () => Promise<void>;
    /** Get the current chat object (including metadata) */
    get: () => Promise<Chat | null>;
    /** Update metadata for the current chat */
    updateMetadata: (metadata: ChatMetadata) => Promise<void>;
  };
}
```

### 7. Update SendMessageOptions

Location: `packages/client/src/hooks/useChatManagement.ts`

Allow setting metadata when programmatically sending a message with `newChat: true`:

```typescript
interface SendMessageOptions {
  newChat?: boolean;
  attachments?: File[];
  openChat?: boolean;
  /** Metadata to set on the new chat (only used when newChat: true) */
  metadata?: ChatMetadata;
}
```

Update `sendMessage` implementation:

```typescript
if (newChat) {
  await createNewChat({ metadata: options?.metadata });
}
```

### 8. Update FileTransformer Interface

Location: `packages/client/src/fileUpload/types.ts` (on feature/file-transformers branch)

Add chat context to the transformer:

```typescript
import type { Chat } from '../providers/chatRepository/types';

/**
 * Context provided to file transformers.
 */
export interface FileTransformerContext {
  /** The current chat (includes metadata) */
  chat: Chat | null;
}

/**
 * A transformer that converts files into string representations for the AI.
 */
export interface FileTransformer {
  /**
   * Transform the file into a string representation for the AI.
   *
   * @param file - The file to transform
   * @param context - Context including the current chat and its metadata
   * @param onProgress - Optional callback for reporting progress (0-100)
   * @returns A string representation the AI will receive
   * @throws If transformation fails
   */
  transform(
    file: File,
    context: FileTransformerContext,
    onProgress?: (progress: number) => void
  ): Promise<string>;
}
```

### 9. Update useFileUpload to Pass Chat Context

Location: `packages/client/src/hooks/useFileUpload.tsx`

The hook needs access to the current chat to pass to transformers:

```typescript
interface UseFileUploadOptions {
  config?: FileUploadConfig;
  disabled?: boolean;
  resetDependency?: unknown;
  /** Function to get the current chat (for transformer context) */
  getCurrentChat?: () => Promise<Chat | null>;
}

// In runTransformer:
const runTransformer = useCallback(async (
  attachmentId: string,
  file: File,
  transformer: FileTransformer
) => {
  setProcessingState(prev => new Map(prev).set(attachmentId, { status: 'processing' }));

  try {
    // Get current chat for context
    const chat = await getCurrentChat?.() ?? null;
    const context: FileTransformerContext = { chat };

    const transformedContent = await transformer.transform(file, context, (progress) => {
      setProcessingState(prev => new Map(prev).set(attachmentId, {
        status: 'processing',
        progress,
      }));
    });
    // ...
  } catch (error) {
    // ...
  }
}, [getCurrentChat]);
```

### 10. Wire Up getCurrentChat in UseAIProvider

Location: `packages/client/src/providers/useAIProvider.tsx`

Pass `getCurrentChat` to the file upload system:

```typescript
// In ChatUIContextValue or wherever useFileUpload is configured
{
  fileUploadConfig: {
    ...fileUploadConfig,
    // Pass function to get current chat for transformer context
  },
  getCurrentChat,  // Pass this to components that need it
}
```

## File Changes Summary

| File                                                           | Change                                      |
| -------------------------------------------------------------- | ------------------------------------------- |
| `packages/client/src/providers/chatRepository/types.ts`        | Add `ChatMetadata`, update `Chat`, `CreateChatOptions`, `ChatRepository` |
| `packages/client/src/providers/chatRepository/localStorage.ts` | Implement `createChat` with metadata, add `updateMetadata` |
| `packages/client/src/hooks/useChatManagement.ts`               | Add `getCurrentChat`, `updateMetadata`, update `SendMessageOptions` |
| `packages/client/src/providers/useAIProvider.tsx`              | Expose metadata API via context             |
| `packages/client/src/index.ts`                                 | Export `ChatMetadata` type                  |
| `packages/client/src/fileUpload/types.ts`                      | Add `FileTransformerContext`, update `FileTransformer` |
| `packages/client/src/hooks/useFileUpload.tsx`                  | Accept `getCurrentChat`, pass context to transformers |

## Usage Examples

### Setting Metadata When Creating a Chat

```typescript
const { chat } = useAIContext();

// Create chat with initial metadata
const chatId = await chat.create({
  title: 'Invoice OCR',
  metadata: {
    documentType: 'invoice',
    source: 'ocr-button',
  },
});
```

### Setting Metadata via sendMessage

```typescript
const { chat } = useAIContext();

// Programmatically start chat with metadata
await chat.sendMessage('Analyze this invoice', {
  newChat: true,
  metadata: {
    documentType: 'invoice',
    ocrMode: 'high-accuracy',
  },
  attachments: [pdfFile],
});
```

### Updating Metadata After Creation

```typescript
const { chat } = useAIContext();

// Update metadata on current chat
await chat.updateMetadata({
  processingStage: 'extraction-complete',
  extractedFields: ['vendor', 'amount', 'date'],
});
```

### Reading Metadata in File Transformer

```typescript
const invoiceTransformer: FileTransformer = {
  async transform(file, context, onProgress) {
    const { chat } = context;
    const documentType = chat?.metadata?.documentType;

    if (documentType === 'invoice') {
      // Use specialized invoice extraction
      return await extractInvoiceData(file, onProgress);
    } else {
      // Use generic PDF extraction
      return await extractPdfText(file, onProgress);
    }
  },
};
```

## Testing Plan

### Unit Tests

Location: `packages/client/src/providers/chatRepository/localStorage.test.ts`

- `createChat` stores metadata correctly
- `updateMetadata` merges with existing metadata
- `updateMetadata` throws for non-existent chat
- Metadata persists through save/load cycle

Location: `packages/client/src/hooks/useChatManagement.test.ts`

- `getCurrentChat` returns chat with metadata
- `updateMetadata` updates current chat
- `sendMessage` with `newChat: true` and `metadata` creates chat with metadata

### E2E Tests

Location: `apps/example/test/chat-metadata.e2e.test.ts`

- Create chat with metadata → metadata persists
- Update metadata → changes are reflected
- File transformer receives chat metadata
- Programmatic chat invocation with metadata works end-to-end

## Migration Notes

- Existing chats will have `metadata: undefined` - code should handle this gracefully
- The `metadata` field is optional, so no migration script is needed
- listChats should include metadata in the returned chat summaries (update `Omit<Chat, 'messages'>` pattern if needed)

## Open Questions

1. **Should `listChats` include metadata?**
   - Current signature returns `Omit<Chat, 'messages'>`
   - This would naturally include metadata, which seems correct
   - Recommendation: Yes, include metadata in list results

2. **Should metadata updates trigger re-renders?**
   - Recommendation: No, metadata is primarily for programmatic access
   - If UI needs to react to metadata changes, consumer can poll or use their own state

3. **Size limits on metadata?**
   - localStorage has ~5MB limit total
   - Recommendation: Document that metadata should be kept small (< 10KB per chat)
   - No hard enforcement in v1
