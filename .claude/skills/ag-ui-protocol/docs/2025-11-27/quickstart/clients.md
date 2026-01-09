# Build Clients

A client implementation allows you to build conversational applications that leverage AG-UI's event-driven protocol.

## When to Use

Building your own client is useful for:
- Exploring/hacking on the AG-UI protocol
- Custom interfaces (CLI, mobile, Slack, etc.)
- Production use: prefer full-featured clients like CopilotKit

## Basic CLI Client Example

### Setup

```bash
mkdir my-ag-ui-client
cd my-ag-ui-client
pnpm init
pnpm add -D typescript @types/node tsx
pnpm add @ag-ui/client @ag-ui/core @ag-ui/mastra
pnpm add @mastra/core @mastra/memory @mastra/libsql
pnpm add @ai-sdk/openai zod
```

### Create Agent (src/agent.ts)

```typescript
import { openai } from "@ai-sdk/openai"
import { Agent } from "@mastra/core/agent"
import { MastraAgent } from "@ag-ui/mastra"
import { Memory } from "@mastra/memory"
import { LibSQLStore } from "@mastra/libsql"

export const agent = new MastraAgent({
  agent: new Agent({
    name: "AG-UI Assistant",
    instructions: `You are a helpful AI assistant.`,
    model: openai("gpt-4o"),
    memory: new Memory({
      storage: new LibSQLStore({ url: "file:./assistant.db" })
    })
  }),
  threadId: "main-conversation"
})
```

### Create CLI Interface (src/index.ts)

```typescript
import * as readline from "readline"
import { agent } from "./agent"
import { randomUUID } from "@ag-ui/client"

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

async function chatLoop() {
  console.log("AG-UI Assistant started!")
  console.log("Type your messages. Press Ctrl+D to quit.\n")

  return new Promise<void>(resolve => {
    const promptUser = () => {
      rl.question("> ", async input => {
        if (!input.trim()) {
          promptUser()
          return
        }

        rl.pause()

        // Add user message
        agent.messages.push({
          id: randomUUID(),
          role: "user",
          content: input.trim()
        })

        try {
          // Run with event handlers
          await agent.runAgent({}, {
            onTextMessageStartEvent() {
              process.stdout.write("Assistant: ")
            },
            onTextMessageContentEvent({ event }) {
              process.stdout.write(event.delta)
            },
            onTextMessageEndEvent() {
              console.log("\n")
            }
          })
        } catch (error) {
          console.error("Error:", error)
        }

        rl.resume()
        promptUser()
      })
    }

    rl.on("close", () => {
      console.log("\nGoodbye!")
      resolve()
    })

    promptUser()
  })
}

chatLoop().catch(console.error)
```

## Event Handlers

Handle different event types:

```typescript
await agent.runAgent({}, {
  // Text streaming
  onTextMessageStartEvent() {
    process.stdout.write("Assistant: ")
  },
  onTextMessageContentEvent({ event }) {
    process.stdout.write(event.delta)
  },
  onTextMessageEndEvent() {
    console.log("\n")
  },

  // Tool calls
  onToolCallStartEvent({ event }) {
    console.log("Tool call:", event.toolCallName)
  },
  onToolCallArgsEvent({ event }) {
    process.stdout.write(event.delta)
  },
  onToolCallEndEvent() {
    console.log("")
  },
  onToolCallResultEvent({ event }) {
    console.log("Result:", event.content)
  },

  // State updates
  onStateSnapshotEvent({ event }) {
    console.log("State:", event.state)
  },
  onStateDeltaEvent({ event }) {
    console.log("State update:", event.delta)
  },

  // Lifecycle
  onRunStartedEvent({ event }) {
    console.log("Run started:", event.runId)
  },
  onRunFinishedEvent({ event }) {
    console.log("Run finished:", event.runId)
  },
  onRunErrorEvent({ event }) {
    console.error("Run error:", event.message)
  }
})
```

## Adding Tools

### Define a Tool

```typescript
import { createTool } from "@mastra/core/tools"
import { z } from "zod"

export const weatherTool = createTool({
  id: "get-weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name")
  }),
  outputSchema: z.object({
    temperature: z.number(),
    conditions: z.string(),
    location: z.string()
  }),
  execute: async ({ context }) => {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=...`
    )
    const data = await response.json()
    return {
      temperature: data.current.temperature_2m,
      conditions: "Sunny",
      location: context.location
    }
  }
})
```

### Add to Agent

```typescript
export const agent = new MastraAgent({
  agent: new Agent({
    name: "AG-UI Assistant",
    instructions: `You are a helpful assistant with weather capabilities.`,
    model: openai("gpt-4o"),
    tools: { weatherTool }
  }),
  threadId: "main-conversation"
})
```

## Using HttpAgent

Connect to a remote AG-UI server:

```typescript
import { HttpAgent } from "@ag-ui/client"

const agent = new HttpAgent({
  url: "https://your-agent-server.com/agent",
  headers: {
    Authorization: "Bearer your-api-key"
  }
})

// Add initial messages
agent.messages = [
  { id: "1", role: "user", content: "Hello!" }
]

// Run the agent
agent.runAgent({
  runId: "run_123",
  tools: [],
  context: []
}).subscribe({
  next: event => {
    switch (event.type) {
      case "TEXT_MESSAGE_CONTENT":
        console.log(event.delta)
        break
      case "TOOL_CALL_START":
        console.log("Tool:", event.toolCallName)
        break
    }
  },
  error: err => console.error(err),
  complete: () => console.log("Done")
})
```

## Ideas for Extension

- **Rich formatting** - Use `chalk` for colored output
- **Progress indicators** - Show loading states
- **Configuration files** - User settings
- **Conversation persistence** - Save/restore sessions
- **Multiple agents** - Switch between specialized agents
- **Custom tools** - Add domain-specific capabilities

## Source

https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/quickstart/clients.mdx
