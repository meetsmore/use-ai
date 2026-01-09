# File Upload Feature Plan

## Overview

Add file attachment support to the chat UI, allowing users to drag-and-drop or select files to send alongside messages to the AI.

## Requirements

- User can drag-and-drop or click to add files to the chat input
- Files display as chips with an "x" button to remove
- Files remain as local `File` references until send
- "Upload" (S3 or base64 conversion) happens only at send time
- Only lightweight file metadata (name, size, type) is persisted - not file data
- When loading persisted messages, unavailable files show a placeholder
- Abstract `FileUploadBackend` interface for future S3 support
- Configurable max file size (default 10MB)

## AG-UI Protocol Compatibility

AG-UI supports multimodal content in user messages:

```typescript
interface UserMessage {
  id: string;
  role: "user";
  content: string | MultimodalContent[];
}

interface MultimodalContent {
  type: "text" | "image" | "audio" | "file";
  // Type-specific fields
}
```

## Architecture

### Type Definitions

#### File Upload Types (`packages/client/src/fileUpload/types.ts`)

```typescript
export const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/** Persisted file metadata (lightweight, for storage) */
export interface PersistedFileMetadata {
  name: string;
  size: number;
  mimeType: string;
}

/** Runtime file attachment (local File reference until send) */
export interface FileAttachment {
  id: string;
  file: File;
  preview?: string;  // data URL for image thumbnails (generated on attach)
}

/** Abstract file upload backend - converts File to URL at send time */
export interface FileUploadBackend {
  /**
   * Prepare file for sending to AI.
   * Called at send time - converts File to URL.
   * For embed: converts to base64 data URL
   * For S3: uploads and returns public URL
   */
  prepareForSend(file: File): Promise<string>;
}

/** Configuration for file uploads */
export interface FileUploadConfig {
  /** Backend for converting files to URLs at send time */
  backend?: FileUploadBackend;
  /** Max file size in bytes (default: 10MB) */
  maxFileSize?: number;
  /** Accepted MIME types (undefined = all) */
  acceptedTypes?: string[];
}
```

#### Multimodal Content Types (`packages/core/src/types.ts`)

```typescript
/** Content part for multimodal messages */
export type MultimodalContent =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'file'; url: string; mimeType: string; name: string };

/** User message content - string or multimodal */
export type UserMessageContent = string | MultimodalContent[];
```

#### Persistence Types (`packages/client/src/providers/chatRepository/types.ts`)

```typescript
/** Content part for persisted messages */
export type PersistedContentPart =
  | { type: 'text'; text: string }
  | { type: 'file'; file: PersistedFileMetadata };

/** Content that can be persisted */
export type PersistedMessageContent = string | PersistedContentPart[];

export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: PersistedMessageContent;  // Updated from just string
  createdAt: Date;
  displayMode?: MessageDisplayMode;
}
```

### Backend Implementations

#### EmbedFileUploadBackend (`packages/client/src/fileUpload/EmbedFileUploadBackend.ts`)

Single-method implementation - converts File to base64 data URL:

```typescript
export class EmbedFileUploadBackend implements FileUploadBackend {
  async prepareForSend(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }
}
```

#### Future: S3FileUploadBackend

```typescript
export class S3FileUploadBackend implements FileUploadBackend {
  constructor(private getPresignedUrl: (file: File) => Promise<{ uploadUrl: string; publicUrl: string }>) {}

  async prepareForSend(file: File): Promise<string> {
    const { uploadUrl, publicUrl } = await this.getPresignedUrl(file);
    await this.uploadToS3(uploadUrl, file);
    return publicUrl;
  }
}
```

### UI Components

#### FileChip (`packages/client/src/components/FileChip.tsx`)

Small chip component showing:
- Thumbnail (for images)
- File name (truncated)
- Remove button (×)

```typescript
interface FileChipProps {
  attachment: FileAttachment;
  onRemove: () => void;
}
```

#### UseAIChatPanel Updates

- Add `fileUploadConfig` prop
- Add drag-and-drop zone (entire input area)
- Add file input button (optional, for click-to-add)
- Render file chips above the text input
- Handle file validation (size, type)
- Update `onSendMessage` signature to include attachments

### Data Flow

```
1. User drops/selects file(s)
   → Validate size against config.maxFileSize
   → Create FileAttachment with File object (local reference)
   → Generate preview for images (small data URL for thumbnail only)
   → Display as chip

2. User clicks Send
   → For each attachment: backend.prepareForSend(file) → URL
   → Build MultimodalContent[] for AI (with URLs)
   → Build PersistedContentPart[] for storage (metadata only: name, size, mimeType)
   → Send to AI via client.sendPrompt()
   → Save to ChatRepository (metadata only)

3. Loading persisted message with file metadata
   → Show placeholder: "[📎 filename - no longer available]"
   → (Future S3: could store URL in metadata and display)
```

## Implementation Steps

### Phase 1: Core Types and Backend

1. Create `packages/client/src/fileUpload/types.ts`
   - Export `DEFAULT_MAX_FILE_SIZE`, `PersistedFileMetadata`, `FileAttachment`, `FileUploadBackend`, `FileUploadConfig`

2. Create `packages/client/src/fileUpload/EmbedFileUploadBackend.ts`
   - Single method: `prepareForSend(file: File): Promise<string>`

3. Create `packages/client/src/fileUpload/index.ts`
   - Re-export all types and classes

4. Update `packages/core/src/types.ts`
   - Add `MultimodalContent` type
   - Add `UserMessageContent` type

### Phase 2: Persistence Layer

5. Update `packages/client/src/providers/chatRepository/types.ts`
   - Import `PersistedFileMetadata` from fileUpload
   - Add `PersistedContentPart` type
   - Add `PersistedMessageContent` type
   - Update `PersistedMessage.content` type

6. Update `packages/client/src/providers/chatRepository/LocalStorageChatRepository.ts`
   - Handle new content format (should work as-is with JSON serialization)

### Phase 3: UI Components

7. Create `packages/client/src/components/FileChip.tsx`
   - File chip with preview, name, remove button

8. Update `packages/client/src/components/UseAIChatPanel.tsx`
   - Add `fileUploadConfig` prop
   - Add drag-and-drop handlers
   - Add file state management (`FileAttachment[]`)
   - Render file chips above input
   - Update send handler to include attachments
   - Update message rendering for multimodal content (placeholders)

### Phase 4: Provider and Client

9. Update `packages/client/src/providers/useAIProvider.tsx`
   - Add `fileUploadConfig` prop to `UseAIProviderProps`
   - Update `handleSendMessage`:
     - Call `backend.prepareForSend()` for each file
     - Build `MultimodalContent[]` for AI
     - Build `PersistedContentPart[]` for storage (metadata only)
   - Pass config to chat panel

10. Update `packages/client/src/client.ts`
    - Update `sendPrompt` to accept `UserMessageContent` (string or multimodal)
    - Build proper AG-UI message format

### Phase 5: Server Support

11. Update `packages/server/src/agents/AISDKAgent.ts`
    - Handle multimodal content in messages
    - Convert to AI SDK format for Claude API

### Phase 6: Exports

12. Update `packages/client/src/index.ts`
    - Export file upload types and `EmbedFileUploadBackend`

## Test Plan

### Unit Tests

#### FileChip Component (`packages/client/src/components/FileChip.test.tsx`)

- Renders file name
- Renders image preview for image files
- Calls onRemove when × clicked

#### EmbedFileUploadBackend (`packages/client/src/fileUpload/EmbedFileUploadBackend.test.ts`)

- `prepareForSend()` converts file to base64 data URL
- `prepareForSend()` returns correct data URL format

### Integration Tests

#### UseAIChatPanel File Handling (`packages/client/src/components/UseAIChatPanel.test.tsx`)

- Drag-and-drop adds file to attachments
- Click remove button removes file from attachments
- Files over configured maxFileSize are rejected
- Send button is enabled when only files attached (no text)
- Files are cleared after send

### E2E Tests (`apps/example/test/file-upload.e2e.test.ts`)

#### User can add file(s) to the chat

```typescript
test('user can add files via drag and drop', async ({ page }) => {
  // Open chat
  // Create test file buffer
  // Dispatch drag-and-drop events
  // Verify file chip appears with correct name
});

test('user can add multiple files', async ({ page }) => {
  // Add file 1
  // Add file 2
  // Verify both chips appear
});

test('files over max size are rejected', async ({ page }) => {
  // Create file larger than maxFileSize
  // Attempt to add
  // Verify error message shown
});
```

#### User can remove a file from the chat

```typescript
test('user can remove file by clicking x button', async ({ page }) => {
  // Add file
  // Verify chip appears
  // Click × button
  // Verify chip removed
});
```

#### Server receives messages with attachments

```typescript
test('server receives multimodal message with file', async ({ page }) => {
  // Add image file
  // Type message
  // Send
  // Verify AI response acknowledges the image
  // (Claude can describe images, so we can verify it saw the image)
});

test('server receives message with only file (no text)', async ({ page }) => {
  // Add file
  // Send without typing text
  // Verify message sent and AI responds
});
```

#### Only references are persisted in ChatRepository

```typescript
test('file metadata is persisted, not file data', async ({ page }) => {
  // Add image file
  // Send message
  // Read localStorage directly
  // Verify message content contains PersistedFileMetadata (name, size, mimeType)
  // Verify no base64 data in storage
});

test('persisted file shows placeholder on reload', async ({ page }) => {
  // Add file and send
  // Reload page
  // Verify placeholder text "[📎 filename - no longer available]" shown
});
```

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/client/src/fileUpload/types.ts` | Create | Type definitions |
| `packages/client/src/fileUpload/EmbedFileUploadBackend.ts` | Create | Embed backend |
| `packages/client/src/fileUpload/EmbedFileUploadBackend.test.ts` | Create | Unit tests |
| `packages/client/src/fileUpload/index.ts` | Create | Exports |
| `packages/client/src/components/FileChip.tsx` | Create | Chip component |
| `packages/client/src/components/FileChip.test.tsx` | Create | Unit tests |
| `packages/client/src/components/UseAIChatPanel.tsx` | Modify | Add file UI |
| `packages/client/src/components/UseAIChatPanel.test.tsx` | Modify | Add file tests |
| `packages/client/src/providers/chatRepository/types.ts` | Modify | Add content types |
| `packages/client/src/providers/useAIProvider.tsx` | Modify | Add config prop, multimodal send |
| `packages/client/src/client.ts` | Modify | Multimodal sendPrompt |
| `packages/client/src/index.ts` | Modify | Export file upload |
| `packages/core/src/types.ts` | Modify | Add MultimodalContent |
| `packages/server/src/agents/AISDKAgent.ts` | Modify | Handle multimodal |
| `apps/example/test/file-upload.e2e.test.ts` | Create | E2E tests |

## Provider Configuration Example

```typescript
import { UseAIProvider, EmbedFileUploadBackend } from '@meetsmore/use-ai-client';

<UseAIProvider
  serverUrl="wss://..."
  fileUploadConfig={{
    backend: new EmbedFileUploadBackend(),
    maxFileSize: 10 * 1024 * 1024, // 10MB (optional, this is default)
    acceptedTypes: ['image/*', 'application/pdf'], // optional
  }}
>
  <App />
</UseAIProvider>
```

## Future Considerations

### S3 Backend (not in scope)

When implementing `S3FileUploadBackend`:
- `prepareForSend()` uploads to S3 and returns public URL
- Could optionally store URL in `PersistedFileMetadata` for persistence
- Files would persist across sessions (URLs remain valid)

```typescript
class S3FileUploadBackend implements FileUploadBackend {
  constructor(private getPresignedUrl: (file: File) => Promise<{ uploadUrl: string; publicUrl: string }>) {}

  async prepareForSend(file: File): Promise<string> {
    const { uploadUrl, publicUrl } = await this.getPresignedUrl(file);
    await fetch(uploadUrl, { method: 'PUT', body: file });
    return publicUrl;
  }
}
```

### Potential Enhancements (not in scope)

- Upload progress indicator (would need callback in `prepareForSend`)
- Image paste from clipboard
- File preview modal
- Multiple file selection dialog
- Drag-and-drop visual feedback
