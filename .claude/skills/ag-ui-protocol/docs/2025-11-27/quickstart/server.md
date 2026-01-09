# Server Implementation

Server implementations allow you to directly emit AG-UI events from your agent or server. This is ideal when you're building a new agent from scratch or want a dedicated service for your agent capabilities.

## Overview

A server implementation involves:

1. **Setup Phase** - Initialize your AI client and emit `RUN_STARTED`
2. **Request Processing** - Send user messages to the model
3. **Response Streaming** - Forward each chunk as AG-UI events
4. **Completion** - Emit `RUN_FINISHED` or `RUN_ERROR`

## Event Flow

```
Client Request
     │
     ▼
┌─────────────────┐
│  RUN_STARTED    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ TEXT_MESSAGE_*  │ ◄── Streaming response
│ TOOL_CALL_*     │ ◄── Tool invocations
│ STATE_*         │ ◄── State updates
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ RUN_FINISHED    │
│ (or RUN_ERROR)  │
└─────────────────┘
```

## Basic Implementation Pattern

```typescript
import { Observable } from "rxjs"
import { BaseEvent, EventType } from "@ag-ui/core"

function runAgent(input: RunAgentInput): Observable<BaseEvent> {
  return new Observable(observer => {
    const { threadId, runId, messages } = input

    // 1. Emit RUN_STARTED
    observer.next({
      type: EventType.RUN_STARTED,
      threadId,
      runId
    })

    try {
      // 2. Call your AI model
      const stream = callAIModel(messages)

      // 3. Stream the response
      for await (const chunk of stream) {
        if (chunk.type === "text") {
          observer.next({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: chunk.messageId,
            delta: chunk.text
          })
        } else if (chunk.type === "tool_call") {
          observer.next({
            type: EventType.TOOL_CALL_START,
            toolCallId: chunk.id,
            toolCallName: chunk.name
          })
        }
      }

      // 4. Emit RUN_FINISHED
      observer.next({
        type: EventType.RUN_FINISHED,
        threadId,
        runId
      })
      observer.complete()

    } catch (error) {
      // 4. Or emit RUN_ERROR
      observer.next({
        type: EventType.RUN_ERROR,
        threadId,
        runId,
        message: error.message
      })
      observer.complete()
    }
  })
}
```

## HTTP Endpoint Example

Using Express.js with SSE (Server-Sent Events):

```typescript
import express from "express"
import { EventType } from "@ag-ui/core"

const app = express()

app.post("/agent", async (req, res) => {
  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")

  const { threadId, runId, messages } = req.body

  // Emit RUN_STARTED
  res.write(`data: ${JSON.stringify({
    type: EventType.RUN_STARTED,
    threadId,
    runId
  })}\n\n`)

  try {
    // Stream AI response
    const stream = await openai.chat.completions.create({
      model: "gpt-4",
      messages,
      stream: true
    })

    const messageId = generateId()

    res.write(`data: ${JSON.stringify({
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant"
    })}\n\n`)

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      if (content) {
        res.write(`data: ${JSON.stringify({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: content
        })}\n\n`)
      }
    }

    res.write(`data: ${JSON.stringify({
      type: EventType.TEXT_MESSAGE_END,
      messageId
    })}\n\n`)

    res.write(`data: ${JSON.stringify({
      type: EventType.RUN_FINISHED,
      threadId,
      runId
    })}\n\n`)

  } catch (error) {
    res.write(`data: ${JSON.stringify({
      type: EventType.RUN_ERROR,
      threadId,
      runId,
      message: error.message
    })}\n\n`)
  }

  res.end()
})
```

## Handling Tool Calls

```typescript
// When the model wants to call a tool
if (chunk.choices[0]?.delta?.tool_calls) {
  for (const toolCall of chunk.choices[0].delta.tool_calls) {
    if (toolCall.function?.name) {
      // Tool call starting
      res.write(`data: ${JSON.stringify({
        type: EventType.TOOL_CALL_START,
        toolCallId: toolCall.id,
        toolCallName: toolCall.function.name
      })}\n\n`)
    }

    if (toolCall.function?.arguments) {
      // Streaming arguments
      res.write(`data: ${JSON.stringify({
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: toolCall.id,
        delta: toolCall.function.arguments
      })}\n\n`)
    }
  }
}

// When tool call completes
res.write(`data: ${JSON.stringify({
  type: EventType.TOOL_CALL_END,
  toolCallId: toolCall.id
})}\n\n`)
```

## State Management

Emit state updates during the run:

```typescript
// Complete state snapshot
res.write(`data: ${JSON.stringify({
  type: EventType.STATE_SNAPSHOT,
  state: { currentStep: 1, totalSteps: 5 }
})}\n\n`)

// Incremental update
res.write(`data: ${JSON.stringify({
  type: EventType.STATE_DELTA,
  delta: [{ op: "replace", path: "/currentStep", value: 2 }]
})}\n\n`)
```

## Best Practices

1. **Always emit lifecycle events** - `RUN_STARTED` and `RUN_FINISHED`/`RUN_ERROR` are required
2. **Use unique IDs** - Generate unique `messageId` and `toolCallId` values
3. **Handle errors gracefully** - Always emit `RUN_ERROR` on failures
4. **Stream incrementally** - Don't buffer the entire response
5. **Include timestamps** - Optional but helpful for debugging

## Source

https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/quickstart/server.mdx
