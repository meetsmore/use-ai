# File Transformers Feature Plan

## Overview

Add a file transformer system that allows developers to transform uploaded files into alternative representations before sending to the AI. The UI displays files normally, but the actual content sent to Claude is the transformed representation (a string).

**Use Case Example**: When a user uploads a PDF, a transformer could OCR it into structured text/JSON. The chat shows the PDF file chip, but Claude receives the extracted text.

## Requirements

- Developers register transformers via `UseAIProvider`
- Transformers execute on the client (frontend)
- Each transformer specifies which MIME types it handles
- Transformers convert `File` → `string` (the AI-consumable representation)
- Files display normally in the UI (file chips, previews)
- Only the AI receives the transformed content
- If no transformer matches, default file handling applies (base64/URL)
- Multiple transformers can be registered; most specific MIME pattern wins
- Transformers are async to support operations like OCR
- Transformation happens at send time; UI shows "uploading" state until complete
- Transformed content is cached in memory to avoid re-transforming on subsequent messages

## Architecture

### Type Definitions

#### FileTransformer Interface (`packages/client/src/fileUpload/types.ts`)

```typescript
/**
 * A transformer that converts files into string representations for the AI.
 */
export interface FileTransformer {
  /**
   * Transform the file into a string representation for the AI.
   *
   * @param file - The file to transform
   * @param onProgress - Optional callback for reporting progress (0-100).
   *                     If called, UI shows progress bar; otherwise shows spinner.
   * @returns A string representation the AI will receive
   * @throws If transformation fails
   */
  transform(file: File, onProgress?: (progress: number) => void): Promise<string>;
}

/**
 * Map of MIME type patterns to transformers.
 *
 * Keys are MIME type patterns:
 * - Exact match: 'application/pdf'
 * - Partial wildcard: 'image/*'
 * - Global wildcard: '*' or '*/*'
 *
 * When multiple patterns match, the most specific one wins:
 * 1. Exact match (e.g., 'application/pdf')
 * 2. Partial wildcard (e.g., 'image/*')
 * 3. Global wildcard ('*' or '*/*')
 */
export type FileTransformerMap = Record<string, FileTransformer>;

/**
 * Configuration for file uploads (updated).
 */
export interface FileUploadConfig {
  backend?: FileUploadBackend;
  maxFileSize?: number;
  acceptedTypes?: string[];
  /** Map of MIME type patterns to transformers */
  transformers?: FileTransformerMap;
}
```

#### TransformedContent Type (`packages/core/src/types.ts`)

The `transformed_file` type is internal to use-ai. It does not break AG-UI or AI SDK conventions because:
- The server converts `transformed_file` → `text` before passing to AI SDK
- AG-UI protocol only sees standard content types (`text`, `image`, `file`)
- The transformation is transparent to external protocols

```typescript
/**
 * Content types that can be sent to the AI.
 * Extended to support transformed file content.
 */
export type MultimodalContent =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }
  | { type: 'file'; url: string; mimeType: string; name: string }
  | { type: 'transformed_file'; text: string; originalFile: { name: string; mimeType: string; size: number } };
```

### MIME Type Matching Utility (`packages/client/src/fileUpload/mimeTypeMatcher.ts`)

Specificity is determined by:
1. Exact matches (no wildcard) always win
2. For wildcard patterns, longer string = more specific (e.g., `application/*` beats `*`)

```typescript
/**
 * Check if a MIME type matches a pattern.
 * Supports exact match and wildcard patterns ending with '*'.
 *
 * Examples:
 * - 'application/pdf' matches 'application/pdf' (exact)
 * - 'image/png' matches 'image/*' (partial wildcard)
 * - 'text/plain' matches '*' (global wildcard)
 */
export function matchesMimeType(mimeType: string, pattern: string): boolean {
  // Exact match
  if (!pattern.includes('*')) {
    return mimeType === pattern;
  }

  // Wildcard match: convert pattern to regex
  // 'image/*' -> /^image\/.*$/
  // '*' -> /^.*$/
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars (except *)
    .replace(/\*/g, '.*');                   // Convert * to .*
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(mimeType);
}

/**
 * Find the most specific transformer for a MIME type.
 *
 * Specificity rules:
 * 1. Exact match (no wildcard) always wins
 * 2. Among wildcard patterns, longer pattern = more specific
 *
 * Example for 'image/png':
 * - 'image/png' (exact, wins)
 * - 'image/*' (length 7, second)
 * - '*' (length 1, last)
 */
export function findTransformer(
  mimeType: string,
  transformers: FileTransformerMap
): FileTransformer | undefined {
  let bestMatch: FileTransformer | undefined;
  let bestIsExact = false;
  let bestLength = -1;

  for (const [pattern, transformer] of Object.entries(transformers)) {
    if (!matchesMimeType(mimeType, pattern)) {
      continue;
    }

    const isExact = !pattern.includes('*');

    // Exact match always wins over wildcard
    if (isExact && !bestIsExact) {
      bestMatch = transformer;
      bestIsExact = true;
      bestLength = pattern.length;
      continue;
    }

    // If both are exact or both are wildcard, longer pattern wins
    if (isExact === bestIsExact && pattern.length > bestLength) {
      bestMatch = transformer;
      bestLength = pattern.length;
    }
  }

  return bestMatch;
}
```

### Data Flow

```
1. User attaches file
   → File validated (size, type)
   → FileAttachment created with File reference
   → FileChip renders with preview/icon (normal display)

2. User clicks Send
   → UI shows "uploading" state (covers transformation time)
   → For each attachment:
      a. Check if a transformer matches the MIME type (most specific wins)
      b. If match found:
         - Call transformer.transform(file)
         - Cache result keyed by file identity (name + size + lastModified)
         - Create TransformedFileContent with result string
         - originalFile metadata preserved for UI/storage
      c. If no match:
         - Use existing flow (backend.prepareForSend → URL)
   → Build multimodal content array
   → Send to AI
   → UI returns to normal state

3. AI receives content
   → Transformed files appear as text content blocks
   → Non-transformed files appear as file/image content blocks
   → AI can "see" the transformed representation

4. Subsequent messages (chat history)
   → Transformed content already in message history
   → No re-transformation needed; cached content reused
   → Server stores the transformed text, not the file

5. Storage
   → File metadata persisted for UI display
   → Transformed text stored in message content for history replay
```

### Transformation Caching

To avoid re-transforming files on every message:

```typescript
/**
 * Cache for transformed file content.
 * Keyed by file identity (name + size + lastModified).
 */
const transformationCache = new Map<string, string>();

function getFileCacheKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

async function getTransformedContent(
  file: File,
  transformer: FileTransformer
): Promise<string> {
  const cacheKey = getFileCacheKey(file);

  const cached = transformationCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const result = await transformer.transform(file);
  transformationCache.set(cacheKey, result);
  return result;
}
```

The cache lives in memory for the session. When messages are sent with transformed content, the transformed text becomes part of the message history, so subsequent AI calls include the already-transformed content without re-processing.

### UseAIProvider Integration

File processing logic is extracted to a separate utility to keep `handleSendMessage` clean.

#### File Processing Utility (`packages/client/src/fileUpload/processAttachments.ts`)

```typescript
import type { FileAttachment } from './types';
import type { MultimodalContent } from '@meetsmore-oss/use-ai-core';
import type { FileUploadBackend, FileTransformerMap } from './types';
import { findTransformer } from './mimeTypeMatcher';
import { EmbedFileUploadBackend } from './EmbedFileUploadBackend';

export interface ProcessAttachmentsConfig {
  backend?: FileUploadBackend;
  transformers?: FileTransformerMap;
}

// In-memory cache for transformed content
const transformationCache = new Map<string, string>();

function getFileCacheKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/**
 * Get transformed content for a file, using cache if available.
 * Throws if transformation fails.
 */
async function getTransformedContent(
  file: File,
  transformer: FileTransformer
): Promise<string> {
  const cacheKey = getFileCacheKey(file);
  const cached = transformationCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const result = await transformer.transform(file);
  transformationCache.set(cacheKey, result);
  return result;
}

/**
 * Process file attachments into multimodal content for AI.
 * Handles transformation (with caching) or URL encoding.
 * Throws on any processing error - caller should handle and show to user.
 */
export async function processAttachments(
  attachments: FileAttachment[],
  config: ProcessAttachmentsConfig
): Promise<MultimodalContent[]> {
  const backend = config.backend ?? new EmbedFileUploadBackend();
  const transformers = config.transformers ?? {};
  const contentParts: MultimodalContent[] = [];

  for (const attachment of attachments) {
    const transformer = findTransformer(attachment.file.type, transformers);

    if (transformer) {
      // Transform file - let errors propagate
      const transformedText = await getTransformedContent(attachment.file, transformer);
      contentParts.push({
        type: 'transformed_file',
        text: transformedText,
        originalFile: {
          name: attachment.file.name,
          mimeType: attachment.file.type,
          size: attachment.file.size,
        },
      });
    } else {
      // No transformer - use URL encoding
      const url = await backend.prepareForSend(attachment.file);
      if (attachment.file.type.startsWith('image/')) {
        contentParts.push({ type: 'image', url });
      } else {
        contentParts.push({
          type: 'file',
          url,
          mimeType: attachment.file.type,
          name: attachment.file.name,
        });
      }
    }
  }

  return contentParts;
}
```

#### Updated handleSendMessage (`packages/client/src/providers/useAIProvider.tsx`)

```typescript
import { processAttachments } from '../fileUpload/processAttachments';

const handleSendMessage = useCallback(async (message: string, attachments?: FileAttachment[]) => {
  // ... existing setup code ...

  let multimodalContent: MultimodalContent[] | undefined;
  let persistedContent: PersistedMessageContent = message;

  if (attachments && attachments.length > 0) {
    // Build persisted content (metadata only)
    const persistedParts: PersistedContentPart[] = [];
    if (message.trim()) {
      persistedParts.push({ type: 'text', text: message });
    }
    for (const attachment of attachments) {
      persistedParts.push({
        type: 'file',
        file: {
          name: attachment.file.name,
          size: attachment.file.size,
          mimeType: attachment.file.type,
        },
      });
    }
    persistedContent = persistedParts;

    // Process attachments (transformation + URL encoding)
    // Errors propagate and are caught below
    try {
      const fileContent = await processAttachments(attachments, {
        backend: fileUploadConfig?.backend,
        transformers: fileUploadConfig?.transformers,
      });

      // Combine text message with file content
      multimodalContent = [];
      if (message.trim()) {
        multimodalContent.push({ type: 'text', text: message });
      }
      multimodalContent.push(...fileContent);
    } catch (error) {
      // Show error to user, abort send
      setFileError(error instanceof Error ? error.message : 'Failed to process file');
      return;
    }
  }

  // ... rest of existing code (save to storage, send to AI) ...
}, [/* deps */]);
```

### Server Handling

Update `packages/server/src/agents/AISDKAgent.ts` to handle `transformed_file`:

```typescript
const convertToAISDKContent = (content: MessageContent): string | AISDKContentPart[] => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: AISDKContentPart[] = [];
    for (const block of content) {
      if (block.type === 'text') {
        parts.push({ type: 'text', text: block.text });
      } else if (block.type === 'image') {
        parts.push({ type: 'image', image: block.url });
      } else if (block.type === 'file') {
        parts.push({
          type: 'file',
          data: block.url,
          mediaType: block.mimeType || 'application/octet-stream',
        });
      } else if (block.type === 'transformed_file') {
        // Transformed files become text content with file context
        parts.push({
          type: 'text',
          text: `[Content of file "${block.originalFile.name}" (${block.originalFile.mimeType})]:\n\n${block.text}`,
        });
      }
    }
    return parts;
  }
  return '';
};
```

## Developer API

### Basic Usage

```typescript
import { UseAIProvider, FileTransformer } from '@meetsmore-oss/use-ai-client';

// Define a PDF transformer
const pdfTransformer: FileTransformer = {
  async transform(file: File) {
    // Use your preferred PDF library
    const pdfjs = await import('pdfjs-dist');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument(arrayBuffer).promise;

    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item: any) => item.str).join(' ') + '\n';
    }

    return text;
  },
};

// Use in provider - transformers is a map of MIME pattern → transformer
<UseAIProvider
  serverUrl="wss://..."
  fileUploadConfig={{
    transformers: {
      'application/pdf': pdfTransformer,
    },
    acceptedTypes: ['application/pdf', 'image/*'],
  }}
>
  <App />
</UseAIProvider>
```

### Multiple Transformers

Transformers are registered as a map where keys are MIME type patterns. When multiple patterns match, the most specific one wins (exact > partial wildcard > global wildcard).

```typescript
const pdfTransformer: FileTransformer = {
  async transform(file) { /* PDF extraction */ },
};

const imageOCRTransformer: FileTransformer = {
  async transform(file) { /* OCR using Tesseract.js */ },
};

const csvTransformer: FileTransformer = {
  async transform(file) {
    const text = await file.text();
    return `CSV Data:\n${text}`;
  },
};

<UseAIProvider
  serverUrl="wss://..."
  fileUploadConfig={{
    transformers: {
      'application/pdf': pdfTransformer,
      'image/*': imageOCRTransformer,           // Matches all images
      'text/csv': csvTransformer,
      'application/vnd.ms-excel': csvTransformer, // Same transformer for Excel CSV
    },
  }}
>
```

### Specificity Example

```typescript
const transformers = {
  '*/*': fallbackTransformer,        // Lowest priority: matches everything
  'image/*': genericImageTransformer, // Medium priority: matches all images
  'image/png': pngOptimizedTransformer, // Highest priority: exact match for PNG
};

// For 'image/png': pngOptimizedTransformer wins (exact match)
// For 'image/jpeg': genericImageTransformer wins (partial wildcard)
// For 'text/plain': fallbackTransformer wins (global wildcard)
```

### Structured Output

```typescript
const pdfTransformer: FileTransformer = {
  async transform(file) {
    const pages = await extractPdfPages(file);

    // Return structured JSON
    return JSON.stringify({
      filename: file.name,
      pageCount: pages.length,
      pages: pages.map((p, i) => ({
        pageNumber: i + 1,
        text: p.text,
        tables: p.tables,
      })),
    }, null, 2);
  },
};
```

## Implementation Steps

### Phase 1: Core Types and Utilities

1. **Update `packages/client/src/fileUpload/types.ts`**
   - Add `FileTransformer` interface
   - Add `FileTransformerMap` type
   - Add `transformers` to `FileUploadConfig`

2. **Create `packages/client/src/fileUpload/mimeTypeMatcher.ts`**
   - Implement `PatternSpecificity` enum
   - Implement `getMatchSpecificity()` function
   - Implement `matchesMimeType()` function
   - Implement `findTransformer()` function with specificity-based matching

3. **Update `packages/core/src/types.ts`**
   - Add `transformed_file` to `MultimodalContent` union type

### Phase 2: File Processing Utility

4. **Create `packages/client/src/fileUpload/processAttachments.ts`**
   - Implement in-memory transformation cache
   - Implement `processAttachments()` function
   - Add `onFileStatus` callback for progress reporting
   - Handle transformation with caching
   - Throw on error (caller handles)

### Phase 3: Progress Indicator UI

5. **Update `packages/client/src/fileUpload/types.ts`**
   - Add `FileProcessingStatus` type
   - Add `FileProcessingState` interface (status + optional progress)

6. **Create `packages/client/src/components/Spinner.tsx`** (if not exists)
   - Simple CSS spinner component for indeterminate progress

7. **Create `packages/client/src/components/ProgressBar.tsx`**
   - Progress bar component (0-100%)

8. **Update `packages/client/src/components/FileChip.tsx`**
   - Add `processingState` prop
   - Show progress bar if `progress` is defined
   - Show spinner if `progress` is undefined
   - Add error state indicator

### Phase 4: Provider Integration

9. **Update `packages/client/src/providers/useAIProvider.tsx`**
   - Import `processAttachments` utility
   - Add `fileProgress` state for tracking processing
   - Pass `onFileProgress` callback to `processAttachments`
   - Refactor `handleSendMessage` to use `processAttachments`
   - Keep persistence logic in provider (metadata only)

### Phase 5: Server Handling

10. **Update `packages/server/src/agents/AISDKAgent.ts`**
    - Handle `transformed_file` content type
    - Convert to text content with file context prefix

11. **Update `packages/server/src/messageConverter.ts`** (if exists)
    - Ensure message conversion handles new content type

### Phase 6: Exports

12. **Update `packages/client/src/fileUpload/index.ts`**
    - Export `FileTransformer`, `FileTransformerMap`, `FileProcessingState` types
    - Export `matchesMimeType`, `findTransformer` utilities
    - Export `processAttachments` function

13. **Update `packages/client/src/index.ts`**
    - Re-export file transformer types from fileUpload

### Phase 7: Testing

14. **Create unit tests**
    - `packages/client/src/fileUpload/mimeTypeMatcher.test.ts`
      - Test exact match, wildcard match, specificity ordering
      - Test `findTransformer` returns most specific match
    - `packages/client/src/fileUpload/processAttachments.test.ts`
      - Test transformation with caching
      - Test `onFileProgress` callback is called with progress
      - Test throws on transformer error

15. **Create E2E tests** (`apps/example/test/file-transformers.e2e.test.ts`)
    - Test transformed file content is sent to AI
    - Test non-matching files use default handling
    - Test specificity (exact match overrides wildcard)
    - Test progress indicator shows during transformation
    - Test progress bar updates when transformer reports progress

## Test Plan

### Unit Tests

#### MIME Type Matcher (`packages/client/src/fileUpload/mimeTypeMatcher.test.ts`)

```typescript
describe('matchesMimeType', () => {
  it('matches exact MIME type', () => {
    expect(matchesMimeType('application/pdf', 'application/pdf')).toBe(true);
    expect(matchesMimeType('application/pdf', 'image/png')).toBe(false);
  });

  it('matches wildcard pattern', () => {
    expect(matchesMimeType('image/png', 'image/*')).toBe(true);
    expect(matchesMimeType('image/jpeg', 'image/*')).toBe(true);
    expect(matchesMimeType('application/pdf', 'image/*')).toBe(false);
  });

  it('matches universal wildcard', () => {
    expect(matchesMimeType('anything/here', '*/*')).toBe(true);
    expect(matchesMimeType('application/pdf', '*')).toBe(true);
  });
});

describe('findTransformer', () => {
  const pdfTransformer: FileTransformer = { transform: async () => 'pdf' };
  const imageTransformer: FileTransformer = { transform: async () => 'image' };
  const pngTransformer: FileTransformer = { transform: async () => 'png' };
  const fallbackTransformer: FileTransformer = { transform: async () => 'fallback' };

  it('returns exact match over wildcard', () => {
    const transformers: FileTransformerMap = {
      'image/*': imageTransformer,
      'image/png': pngTransformer,
    };

    const result = findTransformer('image/png', transformers);
    expect(result).toBe(pngTransformer);
  });

  it('returns partial wildcard over global wildcard', () => {
    const transformers: FileTransformerMap = {
      '*/*': fallbackTransformer,
      'image/*': imageTransformer,
    };

    const result = findTransformer('image/jpeg', transformers);
    expect(result).toBe(imageTransformer);
  });

  it('returns global wildcard when no better match', () => {
    const transformers: FileTransformerMap = {
      '*/*': fallbackTransformer,
      'image/*': imageTransformer,
    };

    const result = findTransformer('text/plain', transformers);
    expect(result).toBe(fallbackTransformer);
  });

  it('returns undefined when no match', () => {
    const transformers: FileTransformerMap = {
      'application/pdf': pdfTransformer,
    };

    const result = findTransformer('text/plain', transformers);
    expect(result).toBeUndefined();
  });
});
```

#### Process Attachments (`packages/client/src/fileUpload/processAttachments.test.ts`)

```typescript
describe('processAttachments', () => {
  it('transforms files with matching transformer', async () => {
    const transformer: FileTransformer = {
      transform: async (file) => `Transformed: ${file.name}`,
    };

    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
    const attachment: FileAttachment = { id: '1', file };

    const result = await processAttachments([attachment], {
      transformers: { 'application/pdf': transformer },
    });

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('transformed_file');
    expect((result[0] as any).text).toBe('Transformed: test.pdf');
  });

  it('caches transformation results', async () => {
    let callCount = 0;
    const transformer: FileTransformer = {
      transform: async (file) => {
        callCount++;
        return `Transformed: ${file.name}`;
      },
    };

    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
    const attachment: FileAttachment = { id: '1', file };
    const config = { transformers: { 'application/pdf': transformer } };

    await processAttachments([attachment], config);
    await processAttachments([attachment], config);

    expect(callCount).toBe(1); // Called only once due to caching
  });

  it('throws on transformer error', async () => {
    const transformer: FileTransformer = {
      transform: async () => { throw new Error('Transform failed'); },
    };

    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
    const attachment: FileAttachment = { id: '1', file };

    await expect(
      processAttachments([attachment], {
        transformers: { 'application/pdf': transformer },
      })
    ).rejects.toThrow('Transform failed');
  });
});
```

### E2E Tests (`apps/example/test/file-transformers.e2e.test.ts`)

```typescript
test('transformed file content is sent to AI', async ({ page }) => {
  // Register a simple text transformer that uppercases content
  // Upload a .txt file
  // Verify AI response acknowledges the UPPERCASE content
});

test('non-matching files use default handling', async ({ page }) => {
  // Register PDF transformer only
  // Upload an image
  // Verify AI describes the image (not transformed)
});

test('transformer errors show error and prevent send', async ({ page }) => {
  // Register a transformer that throws
  // Upload matching file
  // Click send
  // Verify error message shown
  // Verify message was not sent (no AI response)
});
```

## File Changes Summary

| File                                                         | Action | Description                                                  |
|--------------------------------------------------------------|--------|--------------------------------------------------------------|
| `packages/client/src/fileUpload/types.ts`                    | Modify | Add `FileTransformer`, `FileTransformerMap`, `FileProcessingState` |
| `packages/client/src/fileUpload/mimeTypeMatcher.ts`          | Create | MIME matching with specificity                               |
| `packages/client/src/fileUpload/mimeTypeMatcher.test.ts`     | Create | Unit tests for matcher                                       |
| `packages/client/src/fileUpload/processAttachments.ts`       | Create | File processing with caching and progress callbacks          |
| `packages/client/src/fileUpload/processAttachments.test.ts`  | Create | Unit tests for processing                                    |
| `packages/client/src/fileUpload/index.ts`                    | Modify | Export new types and utilities                               |
| `packages/client/src/components/FileChip.tsx`                | Modify | Add progress overlay (spinner or progress bar)               |
| `packages/client/src/components/Spinner.tsx`                 | Create | CSS spinner component                                        |
| `packages/client/src/components/ProgressBar.tsx`             | Create | Progress bar component (0-100%)                              |
| `packages/core/src/types.ts`                                 | Modify | Add `transformed_file` content type                          |
| `packages/client/src/providers/useAIProvider.tsx`            | Modify | Use `processAttachments`, track file progress                |
| `packages/server/src/agents/AISDKAgent.ts`                   | Modify | Handle `transformed_file` content                            |
| `packages/client/src/index.ts`                               | Modify | Export transformer types                                     |
| `apps/example/test/file-transformers.e2e.test.ts`            | Create | E2E tests                                                    |

## Error Handling

### Transformer Failures

When a transformer throws an error, the entire send operation fails:

- Show error message to user (e.g., "Failed to process file: invoice.pdf")
- Message is not sent
- User can retry (remove problematic file or fix transformer)

This approach is preferred because:
- **Predictable behavior**: User knows exactly what happened
- **No silent degradation**: Avoids sending malformed content to AI
- **Clear recovery path**: User can take action to fix the issue

**Implementation**:

```typescript
// In processAttachments.ts
export async function processAttachments(
  attachments: FileAttachment[],
  config: ProcessAttachmentsConfig
): Promise<MultimodalContent[]> {
  const contentParts: MultimodalContent[] = [];

  for (const attachment of attachments) {
    const transformer = findTransformer(attachment.file.type, config.transformers ?? {});

    if (transformer) {
      // Let errors propagate - caller handles the failure
      const transformedText = await getTransformedContent(attachment.file, transformer);
      contentParts.push({
        type: 'transformed_file',
        text: transformedText,
        originalFile: {
          name: attachment.file.name,
          mimeType: attachment.file.type,
          size: attachment.file.size,
        },
      });
    } else {
      // No transformer - use default URL encoding
      const backend = config.backend ?? new EmbedFileUploadBackend();
      const url = await backend.prepareForSend(attachment.file);
      // ... build content part
    }
  }

  return contentParts;
}

// In useAIProvider.tsx handleSendMessage
try {
  const fileContent = await processAttachments(attachments, config);
  // ... send message
} catch (error) {
  // Show error to user, don't send message
  setFileError(`Failed to process file: ${error.message}`);
  return;
}
```

## Progress Indicator

Currently there is no progress indicator for file uploads—only a global disabled state during message send. Since transformations can take significant time (OCR, large PDFs), we need visual feedback.

### Design

When the user clicks Send with file attachments:
1. Each FileChip shows a progress overlay (grayed out)
2. If transformer reports progress (0-100%), show progress bar
3. If transformer doesn't report progress, show infinite spinner
4. Files remain visible but indicate "processing" state
5. User cannot remove files or send another message during processing
6. On error, overlay shows error indicator

### Implementation

#### Update FileAttachment Type (`packages/client/src/fileUpload/types.ts`)

```typescript
export type FileProcessingStatus = 'idle' | 'processing' | 'done' | 'error';

export interface FileProcessingState {
  status: FileProcessingStatus;
  /** Progress 0-100, or undefined for indeterminate (spinner) */
  progress?: number;
}

export interface FileAttachment {
  id: string;
  file: File;
  preview?: string;
}
```

#### Update FileChip Component (`packages/client/src/components/FileChip.tsx`)

```typescript
interface FileChipProps {
  attachment: FileAttachment;
  onRemove: () => void;
  disabled?: boolean;
  /** Processing state for this file */
  processingState?: FileProcessingState;
}

export function FileChip({ attachment, onRemove, disabled, processingState }: FileChipProps) {
  const isProcessing = processingState?.status === 'processing';
  const hasError = processingState?.status === 'error';
  const progress = processingState?.progress;

  return (
    <div style={{
      ...existingStyles,
      opacity: isProcessing ? 0.6 : 1,
      position: 'relative',
    }}>
      {/* Existing content: preview, filename, size, remove button */}

      {/* Processing overlay */}
      {isProcessing && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(255,255,255,0.7)',
          borderRadius: 'inherit',
        }}>
          {progress !== undefined ? (
            <ProgressBar progress={progress} />
          ) : (
            <Spinner size={16} />
          )}
        </div>
      )}

      {/* Error indicator */}
      {hasError && (
        <div style={{ color: 'red', fontSize: 12 }}>Failed</div>
      )}
    </div>
  );
}
```

#### ProgressBar Component (`packages/client/src/components/ProgressBar.tsx`)

```typescript
interface ProgressBarProps {
  progress: number; // 0-100
}

export function ProgressBar({ progress }: ProgressBarProps) {
  return (
    <div style={{
      width: '80%',
      height: 4,
      background: '#e0e0e0',
      borderRadius: 2,
      overflow: 'hidden',
    }}>
      <div style={{
        width: `${Math.min(100, Math.max(0, progress))}%`,
        height: '100%',
        background: '#2196f3',
        transition: 'width 0.2s ease',
      }} />
    </div>
  );
}
```

#### Update processAttachments to Report Progress

```typescript
export interface ProcessAttachmentsConfig {
  backend?: FileUploadBackend;
  transformers?: FileTransformerMap;
  /** Called when a file's processing state changes */
  onFileProgress?: (fileId: string, state: FileProcessingState) => void;
}

export async function processAttachments(
  attachments: FileAttachment[],
  config: ProcessAttachmentsConfig
): Promise<MultimodalContent[]> {
  const { onFileProgress } = config;

  for (const attachment of attachments) {
    onFileProgress?.(attachment.id, { status: 'processing' });

    try {
      const transformer = findTransformer(attachment.file.type, config.transformers ?? {});

      if (transformer) {
        // Pass progress callback to transformer
        const transformedText = await transformer.transform(
          attachment.file,
          (progress) => {
            onFileProgress?.(attachment.id, { status: 'processing', progress });
          }
        );
        // ... build content part
      } else {
        // No transformer - use URL encoding (no granular progress)
        const url = await backend.prepareForSend(attachment.file);
        // ... build content part
      }

      onFileProgress?.(attachment.id, { status: 'done' });
    } catch (error) {
      onFileProgress?.(attachment.id, { status: 'error' });
      throw error;
    }
  }
}
```

#### Update useAIProvider to Track Progress

```typescript
const [fileProgress, setFileProgress] = useState<Map<string, FileProcessingState>>(new Map());

const handleSendMessage = useCallback(async (message: string, attachments?: FileAttachment[]) => {
  // ... setup ...

  if (attachments && attachments.length > 0) {
    try {
      const fileContent = await processAttachments(attachments, {
        backend: fileUploadConfig?.backend,
        transformers: fileUploadConfig?.transformers,
        onFileProgress: (fileId, state) => {
          setFileProgress(prev => new Map(prev).set(fileId, state));
        },
      });
      // ... continue with send ...
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Failed to process file');
      return;
    } finally {
      setFileProgress(new Map()); // Clear progress after send
    }
  }
}, [/* deps */]);
```

### Example: Transformer with Progress

```typescript
const pdfTransformer: FileTransformer = {
  async transform(file, onProgress) {
    const pdf = await loadPdf(file);
    const totalPages = pdf.numPages;
    let text = '';

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      text += await extractText(page);

      // Report progress after each page
      onProgress?.((i / totalPages) * 100);
    }

    return text;
  },
};
```

### File Changes (Additional)

| File                                              | Action | Description                                   |
|---------------------------------------------------|--------|-----------------------------------------------|
| `packages/client/src/fileUpload/types.ts`         | Modify | Add `FileProcessingStatus`, `FileProcessingState` |
| `packages/client/src/components/FileChip.tsx`     | Modify | Add progress overlay (spinner or progress bar) |
| `packages/client/src/components/Spinner.tsx`      | Create | CSS spinner component                         |
| `packages/client/src/components/ProgressBar.tsx`  | Create | Simple progress bar component                 |

## Future Considerations

### Server-Side Transformers

For heavy operations, allow server-side transformation:

```typescript
export interface ServerFileTransformer {
  /** Where transformation runs */
  location: 'server';
  /** Server endpoint that handles transformation */
  endpoint: string;
}

export interface ClientFileTransformer {
  location?: 'client'; // default
  transform(file: File): Promise<string>;
}

export type FileTransformer = ClientFileTransformer | ServerFileTransformer;
```

### Built-in Transformers

Provide common transformers as opt-in utilities:

```typescript
import { createPdfTransformer, createImageOCRTransformer } from '@meetsmore-oss/use-ai-client/transformers';

const transformers: FileTransformerMap = {
  'application/pdf': createPdfTransformer({ /* options */ }),
  'image/*': createImageOCRTransformer({ language: 'eng' }),
};
```
