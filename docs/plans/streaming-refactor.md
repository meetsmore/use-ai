# Streaming Refactor Plan

This document outlines the plan to refactor use-ai to support true streaming responses using the AG-UI protocol.

## Executive Summary

**Current State**: `AISDKAgent` uses `generateText()` which waits for the complete response before emitting events. Text is sent as a single `TEXT_MESSAGE_CONTENT` event containing the full response.

**Target State**: Use `streamText()` to emit text and tool call deltas in real-time as they arrive from the LLM, providing a responsive user experience.

**Key Insight**: The AG-UI protocol and client-side infrastructure already support streaming. The client accumulates `TEXT_MESSAGE_CONTENT` deltas correctly. Only the server-side agent needs modification.

---

## Table of Contents

1. [Architecture Changes](#1-architecture-changes)
2. [Implementation Plan](#2-implementation-plan)
3. [Testing Strategy](#3-testing-strategy)
4. [Package Upgrades](#4-package-upgrades)
5. [Migration Checklist](#5-migration-checklist)
6. [Risk Assessment](#6-risk-assessment)

---

## 1. Architecture Changes

### 1.1 Current Flow (Non-Streaming)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              AISDKAgent                                  │
│                                                                          │
│   generateText() ───blocks───► complete response                        │
│                                      │                                   │
│                                      ▼                                   │
│   emit TEXT_MESSAGE_START ──► emit TEXT_MESSAGE_CONTENT (full text)     │
│                                      │                                   │
│                                      ▼                                   │
│   emit TEXT_MESSAGE_END ────► emit RUN_FINISHED                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Target Flow (Streaming)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              AISDKAgent                                  │
│                                                                          │
│   streamText() ───yields chunks as they arrive───►                      │
│                                                                          │
│   for await (chunk of fullStream) {                                     │
│     'text'                    → emit TEXT_MESSAGE_CONTENT (small delta) │
│     'tool-call-streaming-start' → emit TOOL_CALL_START                  │
│     'tool-call-delta'         → emit TOOL_CALL_ARGS (args delta)        │
│     'tool-call'               → emit TOOL_CALL_END                      │
│                                  (AI SDK calls execute(), which awaits  │
│                                   client response via promise)          │
│     'tool-result'             → log result, stream continues            │
│   }                                                                      │
│        │                                                                 │
│        ▼                                                                 │
│   emit TEXT_MESSAGE_END ────► emit RUN_FINISHED                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Note**: The `for await` loop naturally blocks when AI SDK calls `execute()` because the async generator doesn't yield the next chunk until the tool execution completes.

### 1.3 Tool Execution Model (Unchanged)

**Key Insight**: The existing tool execution pattern works identically with `streamText()`. No manual stream control is needed.

**Current pattern** (works with both `generateText` and `streamText`):
```typescript
tools: {
  myTool: {
    execute: async (args, { toolCallId }) => {
      // Wait for client to send result (async - can take as long as needed)
      const result = await new Promise((resolve) => {
        session.pendingToolCalls.set(toolCallId, resolve);
      });
      return JSON.parse(result);
    }
  }
}
```

**How it works with streaming**:
1. Stream emits `tool-call-streaming-start` → we emit `TOOL_CALL_START`
2. Stream emits `tool-call-delta` chunks → we emit `TOOL_CALL_ARGS` deltas
3. Stream emits `tool-call` → AI SDK calls our `execute()` function
4. **Our `execute()` awaits the client response** (promise blocks)
5. The `for await` loop naturally waits - no new chunks until execute resolves
6. Client sends result → promise resolves → `execute()` returns
7. Stream emits `tool-result` → we log it
8. Stream continues with more text/tool calls

The stream isn't "paused" or restarted - the async generator simply doesn't yield new chunks until tool execution completes. This is the same behavior as `generateText()`.

### 1.4 Multi-Step Handling

With `generateText()` + `stopWhen(stepCountIs(10))`, AI SDK automatically:
1. Detects tool calls
2. Executes tools (calling our async `execute` functions)
3. Sends results back to LLM
4. Repeats until done or limit reached

With `streamText()`, the **exact same `stopWhen` parameter** is used:
```typescript
const stream = streamText({
  stopWhen: stepCountIs(10),  // Same as generateText - no change needed!
  tools: toolsWithExecute,    // Tools with async execute functions
});

// Stream emits events for each step automatically
// When a tool-call chunk arrives, AI SDK calls execute() and waits
// The for-await loop blocks until execute() resolves
for await (const chunk of stream.fullStream) {
  // Handle text, tool-call-streaming-start, tool-call-delta, tool-result, start-step, finish-step
}
```

**Good news**: No change to the multi-step parameter - `stopWhen` works identically in both functions.

### 1.5 Full Stream Chunk Types

The `fullStream` async iterable yields these chunk types:

| Chunk Type | AG-UI Event | Description |
|------------|-------------|-------------|
| `text` | `TEXT_MESSAGE_CONTENT` | Text delta |
| `reasoning` | (future) `THINKING_*` | Extended thinking (Claude) |
| `tool-call-streaming-start` | `TOOL_CALL_START` | Tool call begins |
| `tool-call-delta` | `TOOL_CALL_ARGS` | Tool argument delta |
| `tool-call` | `TOOL_CALL_END` | Tool call complete |
| `tool-result` | (log only) | Tool execution result |
| `start-step` | `STEP_STARTED` | New step begins |
| `finish-step` | `STEP_FINISHED` | Step completes (has usage) |
| `start` | (internal) | Stream begins |
| `finish` | (internal) | Stream ends |
| `source` | (future) | RAG sources |
| `file` | (future) | Generated files |
| `error` | `RUN_ERROR` | Error occurred |
| `abort` | `RUN_ERROR` | Stream aborted |

---

## 2. Implementation Plan

### Phase 1: Core Streaming (AISDKAgent)

**File**: `packages/server/src/agents/AISDKAgent.ts`

#### Step 1.1: Replace generateText with streamText

```typescript
// Before
import { generateText, ... } from 'ai';

const result = await generateText({
  model: this.model,
  messages: sanitizedInputMessages,
  system: systemPrompt,
  tools: this.sanitizeToolsForAPI(tools, session, events),
  stopWhen: stepCountIs(10),
  maxOutputTokens: 4096,
});

// After
import { streamText, ... } from 'ai';

const stream = streamText({
  model: this.model,
  messages: sanitizedInputMessages,
  system: systemPrompt,
  tools: this.sanitizeToolsForAPI(tools, session, events),
  stopWhen: stepCountIs(10),  // Same parameter - no change needed!
  maxOutputTokens: 4096,
  abortSignal: session.abortController?.signal,  // NEW: Support abort
  onStepFinish: ({ usage, finishReason }) => {    // NEW: Per-step telemetry
    logger.debug('Step finished', { usage, finishReason });
  },
});
```

#### Step 1.2: Implement stream processing

Two approaches are available:

**Option A: `for await` loop (explicit control)**
```typescript
for await (const chunk of stream.fullStream) {
  // Handle each chunk type
}
```

**Option B: `onChunk` callback (stream pauses until callback returns)**
```typescript
const stream = streamText({
  // ...
  onChunk: async ({ chunk }) => {
    // Emit AG-UI events - stream waits for this to complete
  },
});
await stream.consumeStream();  // Consume without manual iteration
```

**Recommended: Option A** for explicit control. Full implementation:

```typescript
async run(input: AgentInput, events: EventEmitter): Promise<AgentResult> {
  // ... setup code (emit RUN_STARTED, MESSAGES_SNAPSHOT, STATE_SNAPSHOT) ...

  try {
    const stream = streamText({
      model: this.model,
      messages: sanitizedInputMessages,
      system: systemPrompt,
      tools: tools.length > 0 ? this.sanitizeToolsForAPI(tools, session, events) : undefined,
      stopWhen: stepCountIs(10),
      maxOutputTokens: 4096,
      abortSignal: session.abortController?.signal,
      experimental_telemetry: this.langfuse?.enabled ? {...} : undefined,
      onStepFinish: ({ usage, finishReason }) => {
        logger.debug('Step finished', { usage, finishReason });
      },
    });

    let messageId: string | null = null;
    let hasEmittedTextStart = false;
    let finalText = '';
    let currentStepNumber = 0;

    // Track tool calls for streaming
    const activeToolCalls = new Map<string, { name: string; args: string }>();

    for await (const chunk of stream.fullStream) {
      switch (chunk.type) {
        case 'start-step': {
          // New step beginning (for multi-step tool execution)
          events.emit<StepStartedEvent>({
            type: EventType.STEP_STARTED,
            stepNumber: currentStepNumber++,
            timestamp: Date.now(),
          });
          break;
        }

        case 'text': {
          // Start text message on first text chunk
          if (!hasEmittedTextStart) {
            messageId = uuidv4();
            events.emit<TextMessageStartEvent>({
              type: EventType.TEXT_MESSAGE_START,
              messageId,
              role: 'assistant',
              timestamp: Date.now(),
            });
            hasEmittedTextStart = true;
          }

          // Emit delta
          events.emit<TextMessageContentEvent>({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: messageId!,
            delta: chunk.text,
            timestamp: Date.now(),
          });
          finalText += chunk.text;
          break;
        }

        case 'reasoning': {
          // Extended thinking (Claude) - future AG-UI support
          // For now, could log or emit custom event
          logger.debug('Reasoning:', chunk.text);
          break;
        }

        case 'tool-call-streaming-start': {
          // Emit TOOL_CALL_START when tool call begins streaming
          events.emit<ToolCallStartEvent>({
            type: EventType.TOOL_CALL_START,
            toolCallId: chunk.toolCallId,
            toolCallName: chunk.toolName,
            parentMessageId: messageId ?? uuidv4(),
            timestamp: Date.now(),
          });
          activeToolCalls.set(chunk.toolCallId, { name: chunk.toolName, args: '' });
          break;
        }

        case 'tool-call-delta': {
          // Stream tool arguments
          const toolCall = activeToolCalls.get(chunk.toolCallId);
          if (toolCall) {
            toolCall.args += chunk.argsTextDelta;
            events.emit<ToolCallArgsEvent>({
              type: EventType.TOOL_CALL_ARGS,
              toolCallId: chunk.toolCallId,
              delta: chunk.argsTextDelta,
              timestamp: Date.now(),
            });
          }
          break;
        }

        case 'tool-call': {
          // Tool call complete - emit TOOL_CALL_END
          // AI SDK will call execute() and stream pauses until it returns
          events.emit<ToolCallEndEvent>({
            type: EventType.TOOL_CALL_END,
            toolCallId: chunk.toolCallId,
            timestamp: Date.now(),
          });
          break;
        }

        case 'tool-result': {
          // Tool execution completed (by execute function)
          logger.toolResult(chunk.toolName, JSON.stringify(chunk.output));
          break;
        }

        case 'finish-step': {
          // Step completed - has usage info for telemetry
          events.emit<StepFinishedEvent>({
            type: EventType.STEP_FINISHED,
            stepNumber: currentStepNumber - 1,
            usage: chunk.usage,
            finishReason: chunk.finishReason,
            timestamp: Date.now(),
          });
          break;
        }

        case 'error': {
          throw chunk.error;
        }

        case 'abort': {
          // Stream was aborted via AbortSignal
          events.emit<RunErrorEvent>({
            type: EventType.RUN_ERROR,
            error: 'Run aborted by user',
            timestamp: Date.now(),
          });
          return { success: false, conversationHistory: session.conversationHistory };
        }

        // Ignored chunk types (for now):
        // 'start', 'finish' - internal stream lifecycle
        // 'source' - RAG sources (future)
        // 'file' - generated files (future)
      }
    }

    // End text message if we started one
    if (hasEmittedTextStart && messageId) {
      events.emit<TextMessageEndEvent>({
        type: EventType.TEXT_MESSAGE_END,
        messageId,
        timestamp: Date.now(),
      });
    }

    // Get final result for conversation history
    const result = await stream;

    // Update conversation history
    const responseMessages = result.response.messages;
    const sanitizedMessages = this.sanitizeMessages(responseMessages);
    session.conversationHistory.push(...sanitizedMessages);

    // Emit RUN_FINISHED
    events.emit<RunFinishedEvent>({
      type: EventType.RUN_FINISHED,
      threadId: session.threadId,
      runId,
      result: finalText,
      timestamp: Date.now(),
    });

    return {
      success: true,
      conversationHistory: session.conversationHistory,
    };

  } catch (error) {
    // ... error handling (unchanged) ...
  }
}
```

#### Step 1.3: Update tool sanitization

The `sanitizeToolsForAPI` method needs minor updates:

1. **Remove event emission from execute functions** - TOOL_CALL events are now emitted from the stream loop
2. **Use `toolCallId` from AI SDK options** - The execute function receives this automatically

```typescript
// Updated createClientToolExecutor:
private createClientToolExecutor(
  toolDef: ToolDefinition,
  session: ClientSession
): (args: ToolArguments, options: { toolCallId: string }) => Promise<ToolResult> {
  return async (args: ToolArguments, { toolCallId }) => {
    // toolCallId is provided by AI SDK in the execute options
    // TOOL_CALL events are emitted by the stream processing loop, not here
    const result = await new Promise<string>((resolve) => {
      session.pendingToolCalls.set(toolCallId, resolve);
    });

    logger.toolResult(toolDef.name, result);
    return JSON.parse(result);
  };
}
```

The key change: we no longer call `emitToolCallEvents()` inside the execute function since the stream loop handles that via `tool-call-streaming-start`, `tool-call-delta`, and `tool-call` chunks.

### Phase 2: Remove generateText Code

After streaming is working:

1. Remove `generateText` import
2. Remove `processResponse` method (logic merged into `run`)
3. Update any references to result structure

Note: `stopWhen` import stays - it's used identically in `streamText`.

### Phase 3: Client Verification

The client (`packages/client/src/client.ts`) should already handle streaming correctly:

```typescript
// This code already accumulates deltas:
else if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
  const e = event as TextMessageContentEvent;
  this._currentMessageContent += e.delta;  // Works with small or large deltas
}
```

**Verify**:
- [ ] UI updates incrementally as deltas arrive
- [ ] Tool call arguments accumulate correctly
- [ ] Final message content matches accumulated deltas

### Phase 4: Workflow Plugin (if applicable)

Check if `WorkflowsPlugin` or `DifyWorkflowRunner` need streaming updates. Current implementation in `packages/plugin-workflows/` may already handle SSE streaming from Dify.

---

## 3. Testing Strategy

### 3.1 Unit Tests (MockLanguageModelV3)

**File**: `packages/server/src/agents/AISDKAgent.test.ts`

The AI SDK provides `MockLanguageModelV3` and `simulateReadableStream` for streaming tests:

```typescript
import { MockLanguageModelV3 } from 'ai/test';
import { simulateReadableStream } from 'ai';

describe('AISDKAgent streaming', () => {
  test('emits TEXT_MESSAGE_CONTENT events incrementally', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 'text-1' },
            { type: 'text-delta', id: 'text-1', delta: 'Hello ' },
            { type: 'text-delta', id: 'text-1', delta: 'world!' },
            { type: 'text-end', id: 'text-1' },
            {
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            },
          ],
        }),
      }),
    });

    const agent = new AISDKAgent({ model: mockModel });
    const emittedEvents: AGUIEvent[] = [];
    const eventEmitter: EventEmitter = {
      emit: (event) => emittedEvents.push(event),
    };

    await agent.run(input, eventEmitter);

    // Verify multiple TEXT_MESSAGE_CONTENT events
    const contentEvents = emittedEvents.filter(e => e.type === EventType.TEXT_MESSAGE_CONTENT);
    expect(contentEvents.length).toBe(2);
    expect((contentEvents[0] as any).delta).toBe('Hello ');
    expect((contentEvents[1] as any).delta).toBe('world!');
  });

  test('streams tool call arguments incrementally', async () => {
    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'tool-call-streaming-start', toolCallId: 'tc1', toolName: 'test_tool' },
            { type: 'tool-call-delta', toolCallId: 'tc1', argsTextDelta: '{"val' },
            { type: 'tool-call-delta', toolCallId: 'tc1', argsTextDelta: 'ue":"test"}' },
            { type: 'tool-call', toolCallId: 'tc1', toolName: 'test_tool', args: { value: 'test' } },
            { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
          ],
        }),
      }),
    });

    // ... test tool call streaming events ...
  });

  test('handles multi-step tool execution with streaming', async () => {
    // Test that stopWhen works correctly with streaming
    // Mock model returns tool call, then text after tool result
  });
});
```

**Key difference**: Use `simulateReadableStream` helper which provides proper stream simulation with optional delays:
```typescript
simulateReadableStream({
  initialDelayInMs: 100,  // Delay before first chunk
  chunkDelayInMs: 50,     // Delay between chunks
  chunks: [...],
})
```

### 3.2 Integration/E2E Tests

E2E tests in `apps/example/test/` use real API calls. They should continue to work since the external behavior (final message content) is unchanged.

**Verify streaming behavior**:
```typescript
test('response streams incrementally', async ({ page }) => {
  // Send message
  await page.fill('[data-testid="chat-input"]', 'Hello');
  await page.click('[data-testid="send-button"]');

  // Verify content appears incrementally (not all at once)
  const messageContainer = page.locator('[data-testid="assistant-message"]');

  // Check that content grows over time
  const initialContent = await messageContainer.textContent();
  await page.waitForTimeout(100);
  const laterContent = await messageContainer.textContent();

  // Content should have grown (streaming)
  expect(laterContent?.length).toBeGreaterThan(initialContent?.length ?? 0);
});
```

### 3.3 Test Migration Checklist

| Test File | Changes Needed |
|-----------|----------------|
| `AISDKAgent.test.ts` | Update mocks from `doGenerate` to `doStream` |
| `server.test.ts` | Verify event emission timing |
| `*.e2e.test.ts` | Should work unchanged; add streaming-specific tests |

---

## 4. Package Upgrades

### 4.1 AI SDK Version

Current version check needed. For streaming support, ensure:

```json
{
  "dependencies": {
    "ai": "^4.0.0"  // or latest v4.x with streamText support
  }
}
```

The `streamText` function and `fullStream` property are available in AI SDK v4+.

### 4.2 Check for Breaking Changes

```bash
# Check current version
cat packages/server/package.json | grep '"ai"'

# Check for updates
npm view ai versions --json | tail -20
```

Key features needed from AI SDK:
- `streamText()` function
- `fullStream` async iterable with typed chunks
- `tool-call-streaming-start` and `tool-call-delta` chunk types
- `stopWhen` parameter (same as `generateText`)
- `simulateReadableStream` for testing
- Execute function receives `{ toolCallId, messages, abortSignal }` in options
- `onChunk`, `onStepFinish`, `onFinish`, `onAbort` callbacks

---

## 5. Migration Checklist

### Pre-Implementation
- [ ] Verify AI SDK version supports required streaming features
- [ ] Review `MockLanguageModelV3` streaming capabilities
- [ ] Create backup branch

### Implementation
- [ ] **Phase 1**: Implement streaming in `AISDKAgent.run()`
  - [ ] Replace `generateText` with `streamText`
  - [ ] Add `abortSignal` parameter
  - [ ] Add `onStepFinish` callback for telemetry
  - [ ] Implement `fullStream` iteration loop
  - [ ] Handle `start-step` → emit `STEP_STARTED`
  - [ ] Handle `text` → emit `TEXT_MESSAGE_CONTENT` (small deltas)
  - [ ] Handle `reasoning` → log or future thinking events
  - [ ] Handle `tool-call-streaming-start` → emit `TOOL_CALL_START`
  - [ ] Handle `tool-call-delta` → emit `TOOL_CALL_ARGS` (incremental)
  - [ ] Handle `tool-call` → emit `TOOL_CALL_END`
  - [ ] Handle `tool-result` → log result
  - [ ] Handle `finish-step` → emit `STEP_FINISHED` with usage
  - [ ] Handle `error` → throw
  - [ ] Handle `abort` → emit `RUN_ERROR`, return early
  - [ ] Update conversation history from final result

- [ ] **Phase 2**: Remove non-streaming code
  - [ ] Remove `generateText` import
  - [ ] Remove `processResponse` method
  - [ ] Keep `stopWhen` import (used in both)

- [ ] **Phase 3**: Update tests
  - [ ] Migrate unit tests to use `doStream` mock
  - [ ] Add streaming-specific unit tests
  - [ ] Verify E2E tests pass
  - [ ] Add streaming E2E test

- [ ] **Phase 4**: Verify client behavior
  - [ ] Manual testing of incremental text display
  - [ ] Verify tool call UI updates
  - [ ] Test error scenarios

### Post-Implementation
- [ ] Update CLAUDE.md if architecture changed significantly
- [ ] Run full test suite: `bun run test && bun run test:e2e`
- [ ] Performance testing (time to first token)

---

## 6. Risk Assessment

### 6.1 Low Risk

| Risk | Mitigation |
|------|------------|
| Client doesn't handle streaming | Client already accumulates deltas; no changes needed |
| Event ordering | AG-UI protocol defines clear ordering; Socket.IO preserves order |

### 6.2 Medium Risk

| Risk | Mitigation |
|------|------------|
| Tool execution timing | AI SDK's `stopWhen` handles multi-step; execute functions still work |
| Mock model changes | `MockLanguageModelV3` supports `doStream`; use `simulateReadableStream` |
| Conversation history format | Get final messages from `await stream` result |

### 6.3 High Risk

| Risk | Mitigation |
|------|------------|
| AI SDK version incompatibility | Check version before starting; upgrade if needed |
| Error mid-stream | Implement proper cleanup; emit RUN_ERROR |

**Note**: Tool execution is low risk - the existing promise-based pattern works unchanged with `streamText()`. The AI SDK passes `toolCallId` to execute functions automatically.

### 6.4 Rollback Plan

If streaming introduces issues:
1. Revert to `generateText()` implementation
2. Keep streaming code in separate branch for debugging
3. Investigate specific failure scenarios

---

## 7. Future Considerations

### 7.1 Extended Thinking (Claude)

Claude's extended thinking could be supported via:
- `THINKING_TEXT_MESSAGE_START/CONTENT/END` events (AG-UI protocol supports these)
- Requires model-specific configuration

### 7.2 Abort Support

The `streamText` function fully supports abort:

```typescript
// Server-side: pass AbortSignal to streamText
const abortController = new AbortController();
session.abortController = abortController;

const stream = streamText({
  // ...
  abortSignal: abortController.signal,
  onAbort: ({ steps }) => {
    // Cleanup, emit RUN_ERROR
  },
});

// When client sends ABORT_RUN:
socket.on('abort_run', () => {
  session.abortController?.abort();
});
```

The `abort` chunk type in `fullStream` signals when abortion occurs.

### 7.3 Streaming for Workflows

The `DifyWorkflowRunner` already handles SSE streaming from Dify. This refactor focuses on `AISDKAgent` but similar patterns could apply to other runners.

---

## Appendix: Code References

| File | Purpose |
|------|---------|
| `packages/server/src/agents/AISDKAgent.ts` | Main agent implementation (modify) |
| `packages/server/src/agents/types.ts` | Agent interface (unchanged) |
| `packages/client/src/client.ts` | Client event handling (verify only) |
| `packages/core/src/types.ts` | AG-UI event types (unchanged) |
| `packages/server/src/agents/AISDKAgent.test.ts` | Unit tests (update mocks) |
| `apps/example/test/*.e2e.test.ts` | E2E tests (verify + add streaming test) |
