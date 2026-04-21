# Bugfix: Transformed File Content Lost on Chat Rehydration

## Summary

When a user sends a chat message with file attachments that go through a
`FileTransformer` (e.g. OCR), the transformed text content is **not
persisted to localStorage**. Only file metadata is saved. On the next
turn after a Socket.IO reconnect / tab remount, the persisted history is
reloaded and the transformed content is silently dropped. The LLM on the
next turn sees the conversation without the file content, which causes
it to behave as if the previous assistant turn was hallucinated.

## Symptoms

Reported flow in Proone (ProOne) OCR feature:

1. User uploads a PDF and sends it with a short intro message
   ("この書類をOCR読み取り・データ構造化します。")
2. FileTransformer runs OCR server-side, returns markdown
3. Assistant replies correctly with a summary of the document
4. User moves focus to the sidebar — this triggers a client re-mount
   / Socket.IO reconnect, causing the client to reload the chat
   history from localStorage (via `activatePendingChat`)
5. User types "はい" to confirm
6. Assistant replies "書類が添付されていません" and in its thinking
   tokens concludes that the previous response was a hallucination

Langfuse traces confirm that on step 6, the LLM input is literally just
`"はい"` for the current turn and **the intro + OCR content from turn 1
is missing**. The prior assistant response is present in the history
but the user message that produced it has been reduced to just the
intro string.

## Root Cause

### Data flow today

At `packages/client/src/providers/useAIProvider.tsx` lines 584-636 the
order is:

1. Build `persistedParts` from `message` and `attachments`
   - For each attachment: push `{ type: 'file', file: metadata }`
     (name / size / mimeType only — no content)
2. `saveUserMessage(persistedParts)` — writes to localStorage
3. `processAttachments(attachments, ...)` → runtime
   `MultimodalContent[]` that contains
   `{ type: 'transformed_file', text: <OCR result>, originalFile }`
4. Build `multimodalContent` (runtime) = text part + transformed_file
   part and call `sendPrompt`
5. Server converts each `transformed_file` to a text part wrapped with
   `[Content of file "${name}" (${mime})]:\n\n${text}` at
   `packages/server/src/server.ts:571`

On first send, the LLM sees everything correctly. But localStorage only
holds `[{ type: 'text', text: intro }, { type: 'file', file: metadata }]`.
**The transformed text is never written to disk.**

### Rehydration path

`packages/client/src/hooks/useChatManagement.ts:269`:

```ts
clientRef.current.loadMessages(transformMessagesToClientFormat(messages));
```

`packages/client/src/utils/messageConversion.ts:12,34`:

```ts
const textContent = getTextFromContent(msg.content);
// ...
case 'user':
  return { id: msg.id, role: 'user', content: textContent };
```

`packages/client/src/utils/messageContent.ts:7-14`:

```ts
export function getTextFromContent(content: PersistedMessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map(part => part.text)
    .join('\n');
}
```

Two issues compound here:

1. `getTextFromContent` filters out any non-text parts (including
   `type: 'file'`) before joining, so file metadata is silently dropped.
2. `transformMessagesToClientFormat` flattens the resulting text into
   a single string, throwing away the original multipart structure.

Because the transformed OCR text never entered localStorage in the
first place, even preserving the array would not help — there is
nothing to restore. The transformed content has to be persisted too.

## Reproduction

### Manual

1. Open a Proone tenant that has an OCR estimate-upload entry point
2. Start a new AI chat and upload a PDF via the OCR flow (which
   registers a `FileTransformer` for `application/pdf`)
3. Wait for the assistant's summary reply
4. Reload the page, or move focus to the sidebar in a way that causes
   the Socket.IO connection to drop and reconnect (an explicit browser
   refresh works too — the point is that the client rehydrates from
   localStorage instead of using the in-memory `_messages`)
5. Send "はい"
6. Observe that the assistant asks for the document again / claims it
   never saw one

### Programmatic (reduced)

Without a running Proone backend the same bug can be reproduced by:

1. Registering any `FileTransformer` in a `UseAIProvider`
2. Calling `chat.sendMessage(someText, { attachments: [file] })`
3. Inspecting `localStorage` — the saved `PersistedMessage.content`
   array contains a `{ type: 'file', file: metadata }` entry with no
   `text` field
4. Simulating a reload by calling
   `transformMessagesToClientFormat(loaded)` on the persisted chat and
   confirming that the resulting AG-UI `Message.content` is the intro
   string only

## Fix

The fix is small: persist the transformed text produced by
`processAttachments` alongside the metadata, and teach the rehydration
helpers to reconstruct a multipart `content` array from it.

### Files to change

1. **`packages/client/src/providers/chatRepository/types.ts`** — add a
   new content-part type:

   ```ts
   export interface PersistedTransformedFileContent {
     type: 'transformed_file';
     /** The transformed text representation (e.g. OCR'd markdown). */
     text: string;
     originalFile: {
       name: string;
       mimeType: string;
       size: number;
     };
   }

   export type PersistedContentPart =
     | PersistedTextContent
     | PersistedFileContent
     | PersistedTransformedFileContent;
   ```

   The union is additive, so existing consumers continue to compile.

2. **`packages/client/src/providers/useAIProvider.tsx`** — move the
   `saveUserMessage` call to **after** `processAttachments` so the
   transformed content is available when we persist. Build
   `persistedParts` from the runtime `fileContent` array instead of
   from raw `attachments`:

   ```ts
   if (attachments && attachments.length > 0) {
     serverEvents.setLoading(true);
     let fileContent: MultimodalContent[];
     try {
       fileContent = await processAttachments(attachments, {
         getCurrentChat: chatManagement.getCurrentChat,
         backend: fileUploadConfig?.backend,
         transformers: fileUploadConfig?.transformers,
         onFileProgress: (_fileId, state) => setFileProcessingState(state),
       });
     } catch (error) {
       serverEvents.setLoading(false);
       throw error;
     } finally {
       setFileProcessingState(null);
     }

     const persistedParts: PersistedContentPart[] = [];
     if (message.trim()) {
       persistedParts.push({ type: 'text', text: message });
     }
     for (const part of fileContent) {
       if (part.type === 'transformed_file') {
         persistedParts.push({
           type: 'transformed_file',
           text: part.text,
           originalFile: part.originalFile,
         });
       } else if (part.type === 'file' || part.type === 'image') {
         // keep today's metadata-only shape for non-transformed parts
         persistedParts.push({
           type: 'file',
           file: {
             name: attachmentsByContent.get(part)?.file.name ?? '',
             size: attachmentsByContent.get(part)?.file.size ?? 0,
             mimeType: attachmentsByContent.get(part)?.file.type ?? '',
           },
         });
       }
     }
     persistedContent = persistedParts;

     if (activeChatId) {
       await chatManagement.saveUserMessage(activeChatId, persistedContent);
     }

     multimodalContent = [];
     if (message.trim()) {
       multimodalContent.push({ type: 'text', text: message });
     }
     multimodalContent.push(...fileContent);
   }
   ```

   The exact wiring for the non-transformed branch may vary — today we
   only know `name/size/mimeType` from the original `attachments`
   array, so keep that reference around during the loop.

3. **`packages/client/src/utils/messageConversion.ts`** — preserve
   multipart structure for user messages and turn `transformed_file`
   into the same wrapped text the server emits on fresh sends so the
   LLM sees identical input across the two code paths:

   ```ts
   case 'user': {
     if (typeof msg.content === 'string') {
       return { id: msg.id, role: 'user', content: msg.content };
     }
     const parts = msg.content.flatMap((p) => {
       if (p.type === 'text') {
         return [{ type: 'text' as const, text: p.text }];
       }
       if (p.type === 'transformed_file') {
         return [
           {
             type: 'text' as const,
             text: `[Content of file "${p.originalFile.name}" (${p.originalFile.mimeType})]:\n\n${p.text}`,
           },
         ];
       }
       // 'file' metadata-only parts from before this fix cannot be
       // reconstructed; drop them silently so the rest of the
       // history still loads.
       return [];
     });
     return { id: msg.id, role: 'user', content: parts };
   }
   ```

4. **`packages/client/src/utils/messageContent.ts`** — include
   `transformed_file` text when extracting a plain string (used for
   chat title generation):

   ```ts
   export function getTextFromContent(content: PersistedMessageContent): string {
     if (typeof content === 'string') return content;
     return content
       .flatMap((p) => {
         if (p.type === 'text') return [p.text];
         if (p.type === 'transformed_file') return [p.text];
         return [];
       })
       .join('\n');
   }
   ```

### Optional follow-up (not in scope of this fix)

- `packages/client/src/components/UseAIChatPanel.tsx:119,908-911`
  currently renders file chips only for `type: 'file'`. To show a
  chip for transformed files after rehydration, extend `hasFileContent`
  / the filter in the chip render to include `type: 'transformed_file'`
  using `part.originalFile.name` etc. Not blocking — without this
  the transformed message still shows its text content correctly, the
  chip just doesn't appear.

### UX trade-off

`saveUserMessage` (`useChatManagement.ts:312`) does
`setMessages(prev => [...prev, newMessage])`, so the user message
bubble appears the moment the message is persisted. Moving the save
after `processAttachments` means the bubble is delayed by the
transformation time (roughly 10–60s for OCR). The existing loading
spinner already covers this window but the perceived latency changes
from "bubble, then spinner" to "spinner only, then bubble". This is
the simplest fix. If the delay becomes a problem, a follow-up can add
optimistic UI state (render the bubble from an in-memory array and
only persist the final form), but that is strictly additive.

### Backward compatibility

Existing chats in localStorage have the metadata-only `type: 'file'`
parts. After this fix those parts are still dropped on rehydration
(same as today — they were never reconstructable). New chats written
after the fix carry the transformed text and rehydrate correctly. No
storage migration is necessary.

## Testing

The fix is best covered with **unit tests** at the persistence /
rehydration boundary (`utils/messageContent.ts`, `utils/messageConversion.ts`)
plus **integration tests** at the provider level
(`providers/useAIProvider.tsx`). An E2E test is overkill for this fix
since the failure is in a pure data-transformation layer that unit
tests can pin precisely.

### Unit tests

**`packages/client/src/utils/messageContent.test.ts`** (new file if
missing, otherwise extend):

- `getTextFromContent` with `string` input returns it unchanged
- With mixed `[{text}, {transformed_file}]` content it joins both texts
- With `[{text}, {file}]` (legacy metadata-only) it returns only the
  text part and does not throw
- With `[]` returns `''`

**`packages/client/src/utils/messageConversion.test.ts`** (new file if
missing):

- `transformMessagesToClientFormat`:
  - A persisted user message with `content: string` round-trips to a
    user Message with the same string content
  - A persisted user message with
    `[{ type: 'text' }, { type: 'transformed_file', text, originalFile }]`
    produces a user Message whose `content` is a 2-element array:
    `[{ type: 'text' }, { type: 'text', text: '[Content of file "${name}" (${mime})]:\n\n${text}' }]`
  - A persisted user message with a legacy `file` metadata-only part
    emits only the text parts (file part is dropped, no throw)
  - Assistant and tool messages continue to flatten to a string (their
    behavior is unchanged)

These tests guarantee the two helpers stay in sync and the wrapping
format matches what the server emits on fresh sends (grep
`packages/server/src/server.ts:571` if the format changes — both
places need to be updated together).

### Integration tests

**`packages/client/src/providers/useAIProvider.integration.test.tsx`**
(or the existing equivalent — check what is already there first):

- Arrange: mount `UseAIProvider` with a stubbed `ChatRepository`
  (in-memory), a registered `FileTransformer` that resolves to a known
  transformed text, and a stubbed client that captures `sendPrompt`
  calls.
- Act 1: call `chat.sendMessage('intro', { attachments: [file] })` and
  wait for the transformer to complete.
- Assert 1: the `ChatRepository.saveChat` call that followed contains a
  `PersistedMessage` whose `content` is a 2-part array
  `[{ type: 'text', text: 'intro' }, { type: 'transformed_file', text: <known>, originalFile }]`.
  **This is the regression guard — it asserts the transformed text
  actually made it to storage.**
- Act 2: tear down the provider, re-mount it pointing at the same
  repository, and let the chat rehydrate.
- Assert 2: `client.loadMessages` is called with an AG-UI Message array
  whose user message content is a 2-element `text` array and the
  second element includes the wrapped OCR text.
- Act 3: call `chat.sendMessage('はい')` on the remounted provider.
- Assert 3: the captured `sendPrompt` call sees a message history
  containing the original file text — not just "intro" — so the LLM
  would have the same context on turn 2 as on turn 1.

### What to test manually after deploy

1. Run the OCR flow in Proone dev
2. Reload the page (or trigger a Socket reconnect)
3. Send "はい"
4. Verify the assistant tool-calls `addRows` rather than asking for
   the document — this is the real regression and it must hold up
   against reconnect

### Pre-existing related investigation

A related Socket-reconnect / history-loss investigation is captured in
Proone's memory system under
`langfuse-trace-investigation-2026-02-12.md`
(tool-call loss on reconnect). That bug is distinct from this one —
this fix covers user-side multimodal content, not assistant tool
calls — but both share the same underlying issue that in-memory
runtime state is richer than what we persist. If we later address
tool-call persistence in a similar way, the pattern established here
(persist runtime content directly, reconstruct on rehydrate) should
transfer.
