# Agents

Agents are the core components in the AG-UI protocol that process requests and generate responses. They establish a standardized way for front-end applications to communicate with AI services through a consistent interface, regardless of the underlying implementation.

## What is an Agent?

In AG-UI, an agent is a class that:

1. Manages conversation state and message history
2. Processes incoming messages and context
3. Generates responses through an event-driven streaming interface
4. Follows a standardized protocol for communication

Agents can be implemented to connect with any AI service:
- Large language models (LLMs) like GPT-4 or Claude
- Custom AI systems
- Retrieval augmented generation (RAG) systems
- Multi-agent systems

## Agent Architecture

All agents extend the `AbstractAgent` class:

```typescript
import { AbstractAgent, RunAgentInput, RunAgent } from "@ag-ui/client"
import { Observable } from "rxjs"

class MyAgent extends AbstractAgent {
  run(input: RunAgentInput): RunAgent {
    return () => new Observable(observer => {
      // Emit events
      observer.next({ type: "RUN_STARTED", threadId, runId });
      // ... processing ...
      observer.next({ type: "RUN_FINISHED", threadId, runId });
      observer.complete();
    });
  }
}
```

### Core Components

1. **Configuration** - Agent ID, thread ID, initial state
2. **Messages** - Conversation history
3. **State** - Structured data persisting across interactions
4. **Events** - Standardized messages for communication
5. **Tools** - Functions for external system interaction

## Agent Types

### AbstractAgent

The base class that all agents extend. Handles core event processing, state management, and message history.

### HttpAgent

Connects to remote AI services via HTTP:

```typescript
import { HttpAgent } from "@ag-ui/client"

const agent = new HttpAgent({
  url: "https://your-agent-endpoint.com/agent",
  headers: {
    Authorization: "Bearer your-api-key"
  }
})
```

### Custom Agents

Extend `AbstractAgent` for custom integrations:

```typescript
class CustomAgent extends AbstractAgent {
  run(input: RunAgentInput): RunAgent {
    // Implement your agent logic
  }
}
```

## Basic Implementation

```typescript
import {
  AbstractAgent,
  RunAgent,
  RunAgentInput,
  EventType,
  BaseEvent
} from "@ag-ui/client"
import { Observable } from "rxjs"

class SimpleAgent extends AbstractAgent {
  run(input: RunAgentInput): RunAgent {
    const { threadId, runId } = input

    return () => new Observable<BaseEvent>(observer => {
      // 1. Emit RUN_STARTED
      observer.next({
        type: EventType.RUN_STARTED,
        threadId,
        runId
      })

      // 2. Send a message
      const messageId = Date.now().toString()

      observer.next({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant"
      })

      observer.next({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: "Hello, world!"
      })

      observer.next({
        type: EventType.TEXT_MESSAGE_END,
        messageId
      })

      // 3. Emit RUN_FINISHED
      observer.next({
        type: EventType.RUN_FINISHED,
        threadId,
        runId
      })

      observer.complete()
    })
  }
}
```

## Agent Capabilities

### Interactive Communication

Bi-directional communication through event streams:
- Real-time streaming responses character-by-character
- Immediate feedback loops between user and AI
- Progress indicators for long-running operations
- Structured data exchange in both directions

### Tool Usage

Tools are defined and passed from the frontend:

```typescript
// Tool definition
const confirmAction = {
  name: "confirmAction",
  description: "Ask the user to confirm an action",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", description: "Action to confirm" }
    },
    required: ["action"]
  }
}

// Pass tools to agent
agent.runAgent({
  tools: [confirmAction]
})
```

Tool invocation events:
1. `TOOL_CALL_START` - Beginning of tool call
2. `TOOL_CALL_ARGS` - Streaming arguments
3. `TOOL_CALL_END` - Completion

### State Management

Structured state persists across interactions:

```typescript
// Access state
console.log(agent.state.preferences)

// State updates during runs
agent.runAgent().subscribe(event => {
  if (event.type === EventType.STATE_DELTA) {
    console.log("New state:", agent.state)
  }
})
```

### Multi-Agent Collaboration

- Delegate tasks to specialized agents
- Coordinate workflows across multiple agents
- Transfer state and context between agents
- Maintain consistent frontend experience

### Human-in-the-Loop Workflows

- Request human input on decisions
- Pause and resume execution
- Review and modify outputs before finalization
- Combine AI efficiency with human judgment

### Conversational Memory

```typescript
// Access history
console.log(agent.messages)

// Add messages
agent.messages.push({
  id: "msg_123",
  role: "user",
  content: "Can you explain that?"
})
```

## Agent Configuration

```typescript
interface AgentConfig {
  agentId?: string;          // Unique identifier
  description?: string;      // Human-readable description
  threadId?: string;         // Conversation thread ID
  initialMessages?: Message[]; // Starting messages
  initialState?: State;      // Initial state
}

const agent = new HttpAgent({
  agentId: "my-agent-123",
  description: "A helpful assistant",
  threadId: "thread-456",
  initialMessages: [
    { id: "1", role: "system", content: "You are helpful." }
  ],
  initialState: { language: "English" }
})
```

## Using Agents

```typescript
const agent = new HttpAgent({
  url: "https://your-agent-endpoint.com/agent"
})

agent.messages = [
  { id: "1", role: "user", content: "Hello!" }
]

agent.runAgent({
  runId: "run_123",
  tools: [],
  context: []
}).subscribe({
  next: (event) => {
    switch (event.type) {
      case EventType.TEXT_MESSAGE_CONTENT:
        console.log("Content:", event.delta)
        break
    }
  },
  error: (error) => console.error("Error:", error),
  complete: () => console.log("Run complete")
})
```

## Source

https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/agents.mdx
