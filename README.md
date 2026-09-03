# @use-ai

[![CI](https://github.com/meetsmore/use-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/meetsmore/use-ai/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@meetsmore-oss/use-ai-client)](https://www.npmjs.com/package/@meetsmore-oss/use-ai-client)
[![npm](https://img.shields.io/npm/v/@meetsmore-oss/use-ai-server)](https://www.npmjs.com/package/@meetsmore-oss/use-ai-server)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fmeetsmore%2Fuse--ai--server-blue?logo=docker)](https://github.com/meetsmore/use-ai/pkgs/container/use-ai-server)
[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

<img width="420" height="420" alt="image" src="https://github.com/user-attachments/assets/87aea2e3-9680-4164-a92b-e2554d8e2e3b" />

A React client/framework for easily enabling AI to control your users frontend.

### [Demo video](https://github.com/user-attachments/assets/a0dd44e7-a64a-4106-afe2-49e5c8a1cbb4)

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Example](#example)
- [How it works](#how-it-works)
- [Why?](#why)
- [📦 Structure](#-structure)
- [Features](#features)
  - [General](#general)
    - [AG-UI Protocol](#ag-ui-protocol)
    - [Transports](#transports)
  - [Client](#client)
    - [`useAI` hook](#useai-hook)
    - [`UseAIProvider`](#useaiprovider)
    - [Component State via `prompt`](#component-state-via-prompt)
    - [Returning results of a tool to the AI](#returning-results-of-a-tool-to-the-ai)
    - [Tool Definition with Zod safety](#tool-definition-with-zod-safety)
    - [MultiTool Use](#multitool-use)
    - [Multiple Components of the same type](#multiple-components-of-the-same-type)
    - [Invisible (`Provider`) components](#invisible-provider-components)
    - [Suggestions](#suggestions)
    - [Destructive Tool Approval](#destructive-tool-approval)
    - [Chat History](#chat-history)
    - [Chat Metadata](#chat-metadata)
    - [Programmatic Chat Control](#programmatic-chat-control)
    - [Error Code Mapping](#error-code-mapping)
    - [Using the AI directly (without chat UI)](#using-the-ai-directly-without-chat-ui)
    - [Custom UI](#custom-ui)
    - [Slash Commands](#slash-commands)
    - [File Upload](#file-upload)
    - [File Transformers](#file-transformers)
    - [Multimodal Support](#multimodal-support)
    - [Theme Customization](#theme-customization)
    - [Internationalization](#internationalization)
    - [Multi-agent Support](#multi-agent-support)
  - [Server](#server)
    - ['Batteries included' server](#batteries-included-server)
    - [`UseAIServer`](#useaiserver)
    - [External MCPs](#external-mcps)
    - [Rate Limiting](#rate-limiting)
    - [Langfuse](#langfuse)
    - [Feedback](#feedback)
  - [Plugins](#plugins)
    - [`@meetsmore-oss/use-ai-plugin-workflows`](#meetsmore-use-ai-plugin-workflows)
- [Skills](#skills)

## Overview

<img width="1137" height="817" alt="image" src="https://github.com/user-attachments/assets/e8dd5176-cca0-4104-9342-a6dea914f0f8" />

**TodoList.tsx**
```typescript
export default function TodoList() {
  const { todos, addTodo, deleteTodo, toggleTodo } = useTodoLogic();

  const { ref } = useAI({
    tools: { addTodo, deleteTodo, toggleTodo },
    prompt: `Todo List: ${JSON.stringify(todos)}`,
  });
}
```

**index.tsx**
```typescript
root.render(
  <UseAIProvider serverUrl="ws://localhost:8081">
    <App />
  </UseAIProvider>
);
```

1. Components call `useAI` to declare their tools and state (`prompt`) to `use-ai`.
2. `UseAIProvider` provides a floating-action-button chat UI and aggregates `useAI` tools + prompts from all child components.
3. `@meetsmore-oss/use-ai-server` acts as a co-ordinator between your frontend and an LLM.
4. ✨ The LLM can now call your `tools` functions in the frontend as MCPs.

## Installation

### Frontend

```bash
bun add @meetsmore-oss/use-ai-client
```

### Server

The `use-ai` server coordinates between your frontend and AI providers. Choose one of the following methods:

#### Option 1: Docker (Recommended)

**Using `docker run`:**

```bash
docker run -d \
  --name use-ai-server \
  -p 8081:8081 \
  -e ANTHROPIC_API_KEY=your-api-key \
  -e CORS_ORIGIN='*' \
  ghcr.io/meetsmore/use-ai-server:latest
```

**Using `docker-compose`:**

Create a `docker-compose.yml` file:

```yaml
services:
  use-ai-server:
    image: ghcr.io/meetsmore/use-ai-server:latest
    ports:
      - "8081:8081"
    environment:
      # Required: At least one AI provider
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      # - OPENAI_API_KEY=${OPENAI_API_KEY}

      # Optional: Model selection
      # - ANTHROPIC_MODEL=claude-opus-5
      # - OPENAI_MODEL=gpt-4-turbo

      # Optional: Server configuration
      # - PORT=8081
      # - LOG_FORMAT=json
      # - RATE_LIMIT_MAX_REQUESTS=0
      # - RATE_LIMIT_WINDOW_MS=60000

      # CORS: Set to '*' for local dev, or your frontend URL for production
      - CORS_ORIGIN=*

      # Optional: Langfuse observability
      # - LANGFUSE_PUBLIC_KEY=pk-lf-xxx
      # - LANGFUSE_SECRET_KEY=sk-lf-xxx
    restart: unless-stopped
```

Then run:

```bash
docker-compose up -d
```

#### Option 2: As a Library

If you want to integrate the server into your existing application:

```bash
bun add @meetsmore-oss/use-ai-server
```

See [Server > UseAIServer](#useaiserver) for programmatic usage.

## Quick Start

Define your component, and call `useAI` with some tools.

```typescript
function MyTextbox() {
  const [text, setText] = useState()

  useAI({
    tools: {
      setText: defineTool(
        'Set the text of the textbox.',             // description of the tool
        z.object({                                  // zod schema for declaring inputs
          text: z.string().describe('The new text')
        }),
        (input) => {                                // the tool callback to run
          setText(input)                            // <-- your function
          return { success: true }                  // result to send back to the LLM
        }
      )
    },
    prompt: `The textbox text is ${text}`           // The state of the component in text form, for the LLM. 
  })

  return (
    <p>{{text}}</p>
  )
}

export default function App() {
  return (
    <UseAIProvider serverUrl="ws://localhost:8081">
      <MyTextbox/>
    </UseAIProvider>
  )
}
```

Run the server (see [Installation > Server](#server) for more options):

```bash
docker run -d -p 8081:8081 -e ANTHROPIC_API_KEY='your-api-key' -e CORS_ORIGIN='*' ghcr.io/meetsmore/use-ai-server:latest
```

Start your frontend:

```bash
bun dev
```

## Example

If you just want to play with a working example:

```bash
export ANTHROPIC_API_KEY='xxxxx-your-anthropic-api-key-here-xxxxxx'
git clone git@github.com:meetsmore/use-ai.git
bun install
bun dev
```

Visit http://localhost:3000 to see some examples of `use-ai` in action.
The example app code is in `apps/example`.

## How it works

![architecture diagram](assets/architecture.png)

1. [client] `useAI` calls provide javascript functions with metadata to be used as tools.
2. [client] `UseAIProvider` collects all mounted components with `useAI` hooks and sends their tools to a `UseAIServer`.
3. [server] `UseAIServer` co-ordinates between the clientside and the LLM, providing the clientside tools as MCP tools to the LLM.
4. [LLM] The LLM agent runs and invokes clientside tools if needed.
5. [server] The server requests the clientside invoke the clientside tool with the desired arguments from the LLM.
6. [client] The client invokes the requested function with its arguments.

## Why?

You can get a large amount of power from `use-ai`, even by only implementing a handful of tools.
This is partly because `use-ai` supports **MultiTool calls**, so the LLM can ask to batch execute tools in one generation step, which the frontend can then do all at once.

For example, with our todo list example:

```typescript
export default function TodoList() {
  const { todos, addTodo, deleteTodo, toggleTodo } = useTodoLogic();

  const { ref } = useAI({
    tools: { addTodo, deleteTodo, toggleTodo },
    prompt: `Todo List: ${JSON.stringify(todos)}`,
  });
}
```

We can already achieve the following in one shot:

- 'Add a shopping list to bake a new york cheesecake'.
- 'I already have all the sweet ingredients, check them off.'

Even with only **add**, **delete**, and **toggle**, you can already unlock quite a lot of power.

Because the tools are all clientside, we don't need to worry about auth for the MCP tools, because we are only doing things that the clientside application can already do (as we're invoking clientside code).

## 📦 Structure

```bash
├── apps
│   ├── example                  # example app
│   ├── example-nest-mcp-server  # NestJS MCP server example
│   └── use-ai-server-app        # standalone server with dynamic config
├── packages
│   ├── client                   # frontend React library
│   ├── core                     # shared types
│   ├── plugin-workflows         # headless workflow execution plugin
│   ├── plugin-workflows-client  # client hooks for workflows
│   └── server                   # backend server library
```

# Features

## General

### AG-UI Protocol

`@use-ai` partially implements the [AG-UI protocol](https://docs.ag-ui.com/introduction) for communication between `@meetsmore-oss/use-ai-client` and `@meetsmore-oss/use-ai-server`.

Not all aspects of AG-UI protocol are implemented now, but it feel free to open a PR to add any parts of the protocol you need.

There are some minor extensions to the protocol:

**Message Types**:
- `run_workflow`: Trigger headless workflow (use-ai extension) [see `@meetsmore-oss/use-ai-plugin-workflows`]

### Transports

The client reaches the server through a `UseAITransport`. Two transports ship with the library.

| Transport            | Wire                                     | Server endpoint                |
| -------------------- | ---------------------------------------- | ------------------------------ |
| `SocketIOTransport`  | Socket.IO, over polling and WebSocket    | `/socket.io/` (the default)    |
| `WebSocketTransport` | JSON text frames, over a plain WebSocket | `webSocketPath`, default `/ws` |

`UseAIProvider` builds a `SocketIOTransport` from `serverUrl` when you do not pass one, so
nothing changes if you use the bundled server.

Pass `WebSocketTransport` to reach a server that does not serve Socket.IO. Such a server
does not have to be Node. It must accept a WebSocket connection. It must then exchange
the documented frames.

```tsx
import { UseAIProvider, WebSocketTransport } from '@meetsmore-oss/use-ai-client';

root.render(
  <UseAIProvider
    serverUrl="wss://your-server.com"
    transport={new WebSocketTransport('wss://your-server.com/ws')}
  >
    <App />
  </UseAIProvider>
);
```

The bundled server serves both listeners on one port. Set `webSocketPath: null` to serve
Socket.IO only.

To carry the same messages over something else, implement `UseAITransport` yourself. The
interface has five members: `connect`, `disconnect`, `send`, `on` and `connected`.

See [docs/websocket-protocol.md](docs/websocket-protocol.md) for the frames, the turn
sequence, and the reconnection behaviour.

## Client

### `useAI` hook

The fundamental building block for adding AI capabilities to any React component:

```tsx
import { useAI, defineTool } from '@meetsmore-oss/use-ai-client';
import { z } from 'zod';

function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);

  // Define a tool the AI can call
  const addTodo = defineTool(
    'Add a new todo item to the list',
    z.object({
      text: z.string().describe('The text content of the todo item'),
    }),
    (input) => {
      const newTodo = {
        id: Date.now(),
        text: input.text.trim(),
        completed: false,
      };
      setTodos(prev => [...prev, newTodo]);
      return { success: true, message: `Added todo: "${input.text}"` };
    }
  );

  // Register tools and provide current state to AI
  useAI({
    tools: { addTodo },
    prompt: `Current todos: ${JSON.stringify(todos)}`
  });

  return (/* your UI */);
}
```

### `UseAIProvider`

```tsx
import { UseAIProvider } from '@meetsmore-oss/use-ai-client';

root.render(
  <UseAIProvider
    serverUrl="wss://your-server.com"
    systemPrompt="Be concise and friendly in your responses."
    renderChat={true}  // set false to disable built-in chat UI
  >
    <App />
  </UseAIProvider>
);
```

Pass `transport` to reach a server over something other than Socket.IO. See [Transports](#transports).

### Component State via `prompt`

When you call `useAI`, you can provide a prompt that is used to tell the LLM the state of the component in a text-friendly way.

```tsx
  useAI({
    // tools are optional, maybe you only want to expose state to the AI!
    prompt: `Current todos: ${JSON.stringify(todos)}`
  });
```

If `tools` or `prompt` change, they will cause `useAI` to be re-rendered, so the LLM will always have the latest state whenever you invoke it.

### Returning results of a tool to the AI

While `prompt` is good enough to reflect state of a component, your tool call may not update state, or you may trigger side effects.

`useAI` tools can return a result back to the AI:

```tsx
useAI({
  tools: {
    sendEmail: defineTool(
      `Send an email on behalf of the user.`,
      z.object({
        to: z.string().describe('The address to send the email to.')
        body: z.string().describe('The email content.')
      }),
      (input) => {
        sendEmail(input.to, input.body);
        return {
          success: true,
          message: `Email was sent to ${input.to}.`,
          body: input.body
        };
      }
    ),
  }
})
```

### Tool Definition with Zod safety

When you use `defineTool`, zod schemas are used to define the input arguments for the tool.
These are used for validation (to ensure the LLM didn't generate nonsense for your arguments).
The types of the callback function are also matched against the types of the zod schema, so you will get TypeScript errors if they don't match.

### MultiTool Use

LLMs can invoke multiple tools at once (return multiple tool calls in a response).
These are handled in order by `useAI`, but in one batch, which means that you can get bulk-editing functionality just by declaring single-item mutations.

```tsx
useAI({
  tools: { addTodo, deleteTodo },
  prompt: `Todo List: ${JSON.stringify(todos)}`
});
```

User: *"add a shopping list to make tonkotsu ramen"*

The AI automatically calls `addTodo` multiple times for each ingredient, even though you only defined single-item operations.

### Multiple Components of the same type

Use the `id` parameter to differentiate between component instances.

You should use something that the AI can contextually understand, rather than a randomly generated UUID.

```tsx
function ListItem({ rowIndex, label, counter, color }) {
  useAI({
    tools: { updateLabel, incrementCounter, changeColor },
    prompt: `Current state - Label: "${label}", Counter: ${counter}, Color: "${color}"`,
    id: `Row ${rowIndex}`  // AI uses this to target specific rows
  });
}
```

Or use the component's `id` attribute:

```tsx
<ListItem id="Row 1" />  // Automatically used as useAI id
```

### Invisible (`Provider`) components

You may want to expose AI tools from structural components rather than visual ones.
A common use case for this is to provide 'global' tools that are always accessible to the AI on every page, and not bound to a specific component.

You need to tell `useAI` that the component will not re-render when a tool call happens, by providing the `invisible: true` argument.

```tsx
function MyAppRouter() {
  useAI({
    tools: { navigateTo },
    invisible: true  // Don't wait for re-render after tool calls
  });
}
```

Use `enabled: false` to conditionally disable the hook:

```tsx
useAI({
  tools: { addTodo },
  prompt: `Todos: ${JSON.stringify(todos)}`,
  enabled: isLoggedIn  // only register tools when user is logged in
});
```

### Suggestions

If the user opens a brand new chat, it's helpful to give them a call-to-action prompt that they can use, to understand what they can do with your app using AI.

You can do this using the `suggestions` argument of `useAI`:


```tsx
function MyAppRouter() {
  useAI({
    tools: { navigateTo },
    invisible: true  // Don't wait for re-render after tool calls
    suggestions: [
      'Go to my profile page.',
      'Show me the jobs page.'
    ]
  });
}
```

The `UseAIProvider` chat selects 4 random suggestions from all mounted components for display in empty chat pages, users can click them to instantly send them as a message.

### Destructive Tool Approval

For destructive operations (delete, remove, etc.), you can require explicit user approval before the tool executes. This respects the MCP `destructiveHint` annotation to mark tools that need confirmation.

```tsx
const deleteAccount = defineTool(
  'Delete this user\'s account permanently',
  () => { /* deletion logic */ },
  {
    annotations: {
      destructiveHint: true
    }
  }
);
```

When the AI attempts to call a tool marked with `destructiveHint: true`:

1. The tool execution is paused before running
2. An approval dialog appears in the chat UI showing the tool name and arguments
3. The user can click "Allow" to proceed or "Deny" to reject the action
4. If rejected, the AI receives a message that the user denied the action

**Batch Approvals:**

When the AI proposes multiple destructive tool calls at once, they are batched together in a single approval dialog:

- Shows the count of pending actions (e.g., "3 actions are waiting for your approval")
- "Allow All" / "Deny All" buttons to handle all at once
- Expandable details section showing each tool with its arguments

**UI Behavior:**

- While approval is pending, the chat input is replaced by the approval dialog
- Users cannot send new messages until they approve or deny the pending actions
- Tool details can be expanded to see the exact arguments being passed

**Example with schema:**

```tsx
const deleteTodo = defineTool(
  'Delete a todo item from the list',
  z.object({
    id: z.number().describe('The ID of the todo to delete'),
  }),
  (input) => {
    setTodos(prev => prev.filter(t => t.id !== input.id));
    return { success: true, message: `Deleted todo ${input.id}` };
  },
  {
    annotations: {
      destructiveHint: true,
      title: 'Deleting Todo'  // Optional: shown in approval dialog
    }
  }
);
```

### Chat History

By default, there is locally stored chat history for up to 20 chats.

The user can switch between them and resume old chats.

If you wanted to have chats stored on the server, with the users account, you can provide your own `ChatRepository` implementation to do that:

```tsx
import { UseAIProvider } from '@meetsmore-oss/use-ai-client';

root.render(
  <UseAIProvider
    serverUrl="wss://your-server.com"
    chatRepository={{new MyChatRepository()}} // define your own chat repository for storing history.
  >
    <App />
  </UseAIProvider>
);
```

### Chat Metadata

Chats can have arbitrary metadata attached to them. This is useful for storing custom data like document types, customer IDs, or any other context that file transformers or your application logic might need.

**Setting metadata when creating a chat:**

```tsx
const { chat } = useAIContext();

// Create a new chat with metadata
await chat.sendMessage('Process this invoice', {
  newChat: true,
  metadata: { documentType: 'invoice', customerId: '12345' }
});
```

**Accessing and updating metadata:**

```tsx
const { chat } = useAIContext();

// Get the current chat (metadata is frozen to prevent accidental mutation)
const currentChat = await chat.get();
console.log(currentChat?.metadata); // { documentType: 'invoice', customerId: '12345' }

// Update metadata (merges with existing by default)
await chat.updateMetadata({ processed: true });

// Or replace all metadata
await chat.updateMetadata({ newField: 'value' }, true); // overwrite = true
```
```

### Programmatic Chat Control

You can send messages to the chat programmatically from your application code using `chat.sendMessage()` from `useAIContext()`. This is useful for triggering AI conversations from button clicks, form submissions, or other user interactions.

```tsx
import { useAIContext } from '@meetsmore-oss/use-ai-client';

function MyComponent() {
  const { chat } = useAIContext();

  const handleClick = async () => {
    // Send a simple message (opens chat panel automatically)
    await chat.sendMessage('Hello, AI!');
  };

  return <button onClick={handleClick}>Ask AI</button>;
}
```

**Examples:**

```tsx
// Start a fresh conversation
await chat.sendMessage('Let\'s start over', { newChat: true });

// Send with file attachments
const file = document.querySelector('input[type="file"]').files[0];
await chat.sendMessage('Please analyze this file', { attachments: [file] });

// Send without opening the chat panel (background operation)
await chat.sendMessage('Process this in the background', { openChat: false });
```

**Queueing:** If you call `sendMessage` while the AI is still responding, messages are automatically queued and processed one at a time.

**Error Handling:** The function throws an error if not connected to the server. Wrap calls in try/catch for proper error handling:

```tsx
try {
  await chat.sendMessage('Hello!');
} catch (error) {
  console.error('Failed to send message:', error);
}
```

### Error Code Mapping

There are errors which can occur when using LLM APIs, (e.g. rate limiting, overload, etc).
These are defined internally using error codes:

```typescript
/**
 * Error codes sent from server to client.
 * Used to identify specific error types for proper handling and messaging.
 */
export enum ErrorCode {
  /** Error when AI API is experiencing high load (HTTP 529) */
  API_OVERLOADED = 'API_OVERLOADED',
  /** Error when rate limit is exceeded (HTTP 429) */
  RATE_LIMITED = 'RATE_LIMITED',
  /** Generic error for unknown or unexpected errors */
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}
```

On the client, you will want to show friendly errors to the user.
By default, there are reasonable messages in English, but if you needed to localize them to another language, you can pass your own mapping of error codes -> strings:

```tsx
import { UseAIProvider } from '@meetsmore-oss/use-ai-client';

root.render(
  <UseAIProvider
    serverUrl="wss://your-server.com"
    errorMessages={{
      API_OVERLOADED: "Le service IA est actuellement surchargé.",
      RATE_LIMITED: "Trop de requêtes.",
      UNKNOWN_ERROR: "Une erreur s'est produite."
    }}
  >
    <App />
  </UseAIProvider>
);
```

### Using the AI directly (without chat UI)

> TODO: This needs to be easier, using the client currently is awkward.
>       User should get a similar interface to `useAIWorkflow`. 

```typescript
const { 
  serverUrl,
  connected,
  registerTools,
  unregisterTools,
  updatePrompt,
  client,
  currentChatId,
  createNewChat, 
  loadChat, 
  deleteChat, 
  listChats, 
  clearCurrentChat 
} = useAIContext();
```

### Custom UI

If you don't like the default UI, you can customize both the floating-action-button and the chat UI itself.

```tsx
import { UseAIProvider } from '@meetsmore-oss/use-ai-client';

root.render(
  <UseAIProvider
    serverUrl="wss://your-server.com"
    CustomButton={MyCustomButton}
    CustomChat={MyCustomChat}
  >
    <App />
  </UseAIProvider>
);
```

For partial customization, override only the built-in chat regions you own.
Every slot receives the built-in UI as `children`: render it to decorate the
default behavior, or omit it to replace that region completely.

```tsx
import type {
  ChatMessageSlotProps,
  ChatComposerSlotProps,
} from '@meetsmore-oss/use-ai-client';

function Message({ message, children }: ChatMessageSlotProps) {
  return <div className={`my-message my-message-${message.role}`}>{children}</div>;
}

function Composer({ input, onInputChange, onSend, canSend }: ChatComposerSlotProps) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSend(); }}>
      <textarea value={input} onChange={(event) => onInputChange(event.target.value)} />
      <button disabled={!canSend}>Send</button>
    </form>
  );
}

<UseAIProvider
  serverUrl="wss://your-server.com"
  chatComponents={{ Message, Composer }}
>
  <App />
</UseAIProvider>
```

Available slots are `Header`, `EmptyState`, `Message`, `PendingIndicator`,
`Composer`, `ToolApproval`, and `Disclaimer`. Provider-level `chatComponents` apply to all
chat instances. A specific `<UseAIChat components={...} />` takes precedence.

**Migrating a `CustomChat` from 1.17:** `ChatPanelProps` no longer carries
`streamingText` and `streamingReasoning`, and `ReasoningProps` no longer carries
`streamingText`. The in-flight answer now arrives as `streamingParts`, the
ordered parts of the run. Flatten them with the exported helpers:

```tsx
import {
  getTextFromStreamingParts,
  getReasoningPartsFromStreamingParts,
} from '@meetsmore-oss/use-ai-client';

const streamingText = getTextFromStreamingParts(streamingParts);
const streamingReasoning = getReasoningPartsFromStreamingParts(streamingParts);
```

The answer being streamed goes through `Message` too, as a provisional entry
carrying the id it will be persisted under, so `streaming` tells the two apart.

Each region's built-in implementation is exported as `DefaultHeader`,
`DefaultMessage` and so on, taking exactly the props its slot receives. Reuse
one when only part of a region needs to change:

```tsx
import { DefaultMessage, type ChatMessageSlotProps } from '@meetsmore-oss/use-ai-client';

function Message(props: ChatMessageSlotProps) {
  return (
    <>
      <DefaultMessage {...props} />
      {props.isLast && <Citations />}
    </>
  );
}
```

A working example of every slot, including a turn rendered as a timeline, lives
in `apps/example` at `/custom-slots-demo`.

You can also disable them by passing `null`:

```tsx
import { UseAIProvider } from '@meetsmore-oss/use-ai-client';

root.render(
  <UseAIProvider
    serverUrl="wss://your-server.com"
    CustomButton={null}
    CustomChat={null}
  >
    <App />
  </UseAIProvider>
);
```

**`onOpenChange` Callback:**

Use the `onOpenChange` prop to synchronize the chat panel's open/close state with external UI (e.g., a sidebar). This is called when `sendMessage({ openChat: true })` is used programmatically.

```tsx
const [sidebarOpen, setSidebarOpen] = useState(false);

<UseAIProvider
  serverUrl="ws://localhost:8081"
  renderChat={false}
  onOpenChange={(isOpen) => setSidebarOpen(isOpen)}
>
  <Sidebar isOpen={sidebarOpen}>
    <UseAIChat />
  </Sidebar>
</UseAIProvider>
```

### Slash Commands

Save and reuse common prompts with slash commands:

```tsx
const { savedCommands, saveCommand, deleteCommand } = useAIContext();

// Save a command
await saveCommand({ name: 'review', content: 'Review this code for bugs' });

// Use in chat by typing /review
```

Provide custom storage with `commandRepository`:

```tsx
<UseAIProvider serverUrl="ws://localhost:8081" commandRepository={new MyCommandRepository()}>
```

### File Upload

Enable file uploads in chat:

```tsx
<UseAIProvider
  serverUrl="ws://localhost:8081"
  fileUploadConfig={{
    enabled: true,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    backend: new EmbedFileUploadBackend(), // embeds files as base64
  }}
>
```

### File Transformers

File transformers allow you to preprocess files before sending them to the AI. This is useful for extracting text from PDFs, performing OCR on images, or any other file-to-text conversion.

`transform()` receives an array of files matching the MIME pattern, and returns an array of strings (one per file, same order).

```tsx
import { UseAIProvider, FileTransformer } from '@meetsmore-oss/use-ai-client';

const pdfTransformer: FileTransformer = {
  transform: async (files, context, onProgress) => {
    return Promise.all(files.map(async (file) => {
      const text = await extractTextFromPDF(file);
      return text;
    }));
  }
};

<UseAIProvider
  serverUrl="ws://localhost:8081"
  fileUploadConfig={{
    transformers: {
      'application/pdf': pdfTransformer,      // Exact MIME type match
      'image/*': ocrTransformer,              // Wildcard match for all images
    }
  }}
>
```

**MIME Type Matching:**

When multiple patterns match a file, the most specific one wins:
1. Exact match (`application/pdf`)
2. Partial wildcard (`image/*`)
3. Global wildcard (`*`)

Files matching the same MIME pattern key are grouped together and passed as a single array. For example, two `image/*` files are grouped into one `transform()` call:

```tsx
<UseAIProvider
  fileUploadConfig={{
    transformers: {
      'application/pdf': pdfTransformer,  // PDF files grouped separately
      'image/*': imageTransformer,        // All image files grouped together
    }
  }}
>
```

**Progress Reporting:**

- If `onProgress` is called, the UI shows a progress bar
- If `onProgress` is never called, the UI shows a spinner
- Progress values should be 0-100

**Transformer Context:**

Transformers receive a `context` object containing:
- `chat`: The current chat object (includes metadata set via `chat.updateMetadata()`)

This allows transformers to access chat metadata (e.g., document type hints).

### Theme Customization

Customize the chat UI appearance with the `theme` prop (all fields are optional — only override what you need):

```tsx
<UseAIProvider
  serverUrl="ws://localhost:8081"
  theme={{
    primaryColor: '#667eea',
    primaryGradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    backgroundColor: 'white',
    textColor: '#1f2937',
    secondaryTextColor: '#6b7280',
    borderColor: '#e5e7eb',
    onlineColor: '#10b981',
    errorBackground: '#fee2e2',
    errorTextColor: '#dc2626',
    dangerColor: '#ef4444',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  }}
>
```

### Internationalization

Localize all user-facing strings with the `strings` prop (partial objects accepted — only override what you need):

```tsx
<UseAIProvider
  serverUrl="ws://localhost:8081"
  strings={{
    header: {
      aiAssistant: 'AIアシスタント',
      newChat: '新しいチャット',
      online: 'オンライン',
      offline: 'オフライン',
    },
    input: {
      placeholder: 'メッセージを入力...',
      thinking: '考え中',
    },
    toolApproval: {
      title: '確認が必要です',
      approve: '許可',
      reject: '拒否',
    },
  }}
>
```

### Multi-agent Support

When multiple agents are configured, users can select which agent to use:

```tsx
<UseAIProvider
  serverUrl="ws://localhost:8081"
  visibleAgentIds={['claude', 'gpt-4']} // filter visible agents
>
```

```tsx
const { selectedAgent, availableAgents, selectAgent } = useAgentSelection();
```

## Server

### 'Batteries included' server

For most use cases, you can just use `@meetsmore-oss/use-ai-server` as-is, and customize only the environment variables:

```bash
# AI Provider (at least one required)
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# ANTHROPIC_MODEL=claude-opus-5
# ANTHROPIC_WORKSPACE_ID=wrkspc_xxxxxxxxxxxxxxxxxxxxxxx  # Required for an identity-linked key
# OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# OPENAI_MODEL=gpt-4-turbo

# Dify Workflow Runner (optional)
# DIFY_API_URL=http://localhost:3001/v1

# Remote MCP Server Configuration
# MCP_ENDPOINT_YOURMCPNAME_URL=http://localhost:3002
# MCP_ENDPOINT_YOURMCPNAME_NAMESPACE=yourmcpname  # Optional, defaults to "yourmcpname"
# MCP_ENDPOINT_YOURMCPNAME_TIMEOUT=60000          # Optional, defaults to 30000

# Server Configuration (optional)
# PORT=8081
# LOG_FORMAT=pretty
# LOG_SILENT=true                                     # Disable all logging
# DEBUG=1                                             # Enable debug logging
# MAX_HTTP_BUFFER_SIZE=10485760                       # Max payload size in bytes

# Rate Limiting (optional)
# RATE_LIMIT_MAX_REQUESTS=0
# RATE_LIMIT_WINDOW_MS=60000

# Langfuse Observability (optional)
# LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

### `UseAIServer`

If you want to integrate the `use-ai` server into your existing server, for example if you don't want to deploy another instance in your infrastructure, or you want to use some capabilities in your existing server, you can use `@meetsmore-oss/use-ai-server` as a library and run an instance of `UseAIServer`:

```typescript
import { UseAIServer, AISDKAgent } from '@meetsmore-oss/use-ai-server';
import { anthropic } from '@ai-sdk/anthropic';

const server = new UseAIServer({
  port: 8081,
  agents: {
    'claude': new AISDKAgent({
      name: 'Claude',
      annotation: 'Powered by Anthropic', // shown in agent selector UI
      hooks: { loadConfig: () => ({ model: anthropic('claude-opus-5') }) },
    })
  },
  defaultAgent: 'claude',
  webSocketPath: '/ws',   // plain WebSocket listener, see 'Transports'. null to disable.
  rateLimitMaxRequests: 1_000,
  rateLimitWindowMs: 60_000,
  plugins: [              // see 'Plugins'
    new WorkflowsPlugin({ /** see @meetsmore-oss/use-ai-plugin-workflows */})
  ],
  mcpEndpoints: [{        // see 'External MCPs'
    url: 'http://my-app.com/mcp',
    namespace: 'my-app',
    timeout: 30_000,
    toolsCacheTtl: 60_000  // cache tool definitions for 60s
  }],
});
```

### External MCPs

`use-ai` supports providing additional tools using external MCPs, defined by `mcpEndpoints`.
These MCP endpoints should follow the MCP protocol to return a set of tools when called.

The server will invoke these on start, with a refresh interval to reload them periodically.

To configure these in `@meetsmore-oss/use-ai-server`, you can use the environment variables:

```bash
# MCP_ENDPOINT_YOURMCPNAME_URL=http://localhost:3002
# MCP_ENDPOINT_YOURMCPNAME_NAMESPACE=yourmcpname  # Optional, defaults to "yourmcpname"
# MCP_ENDPOINT_YOURMCPNAME_TIMEOUT=60000          # Optional, defaults to 30000
# MCP_ENDPOINT_YOURMCPNAME_TOOLS_CACHE_TTL=60000  # Optional, cache tool definitions

# multiple endpoints are supported
# MCP_ENDPOINT_ANOTHERMCP_URL=http://localhost:3003
```

If your MCP tools need auth (e.g. you want to do things on behalf of the user, in the backend), you can use the `@meetsmore-oss/use-ai-client` `forwardedPropsProvider` prop to do that:

```tsx
import { UseAIProvider } from '@meetsmore-oss/use-ai-client';

root.render(
  <UseAIProvider
    serverUrl="ws://localhost:8081"
    forwardedPropsProvider={() => ({
      mcpHeaders: {
        'http://localhost:3002/*': {        // when any URL matching this pattern is called by the server for MCPs....
          headers: { 'X-API-Key': 'secret-api-key-123' },   // add these headers to the request.
        },
      },
      telemetryMetadata: {                  // optional: metadata forwarded to observability (e.g., Langfuse)
        userId: 'user-123',
      },
    })}
  >
    <App/>
  </UseAIProvider>
);
```

[picomatch](https://github.com/micromatch/picomatch) is used for patterns, so you can use any `picomatch` compatible pattern.

The flow works like this:

1. [client] The user sends a message to the AI.
2. [client] `use-ai` calls the `mcpHeadersProvider` and passes the full 'header map' to the server.
3. [server] The server prompts the LLM.
4. [LLM] The LLM decides to call a tool.
5. [server] The server checks if the call will use a remote MCP, if it will, it adds the headers matching the URL pattern.

### Server-Side Tools

Server-side tools execute directly in the server process using `defineServerTool()`. Unlike client tools (which round-trip via Socket.IO) or MCP tools (which call remote HTTP endpoints), server tools are simple function calls with no network overhead.

```typescript
import { UseAIServer, defineServerTool } from '@meetsmore-oss/use-ai-server';
import { z } from 'zod';

const server = new UseAIServer({
  agents: { /* ... */ },
  defaultAgent: 'claude',
  tools: {
    // Without parameters
    getServerTime: defineServerTool(
      'Get the current server time',
      async () => new Date().toISOString(),
      { annotations: { readOnlyHint: true } }
    ),
    // With Zod schema
    addNumbers: defineServerTool(
      'Add two numbers together',
      z.object({ a: z.number(), b: z.number() }),
      async ({ a, b }) => ({ result: a + b }),
      { annotations: { readOnlyHint: true } }
    ),
  },
});
```

**Execution Context:**

Server tool execute functions receive a `ServerToolContext` as the second argument, providing access to the current session, app state, run ID, and tool call ID:

```typescript
defineServerTool(
  'Get user-specific data',
  z.object({ key: z.string() }),
  async ({ key }, context) => {
    // context.session   - current client session
    // context.state     - latest app state from client
    // context.runId     - current agent run ID
    // context.toolCallId - this tool call's ID
    return db.get(key);
  }
);
```

| Type       | Defined In       | Executed In      | Use Case                       |
|------------|------------------|------------------|--------------------------------|
| **Server** | Server config    | Server process   | DB queries, internal APIs      |
| **Client** | React components | Browser          | UI state, DOM manipulation     |
| **MCP**    | Remote endpoint  | External service | Third-party integrations       |

### Rate Limiting

`UseAIServer` supports rate limiting by IP.
This allows you to implement `use-ai` without auth, and just rely on rate limiting to prevent abuse of your token spend.

You can configure it using environment variables if using `@meetsmore-oss/use-ai-server` directly:

``` bash
# Rate Limiting (optional)
RATE_LIMIT_MAX_REQUESTS=0
RATE_LIMIT_WINDOW_MS=60000
```

Or you can use arguments to `UseAIServer`:

```typescript
  const server = new UseAIServer({
    port: 8081,
    agents: {
      'claude': new AISDKAgent({ /** see AISDKAgent for an example */ })
    },
    defaultAgent: 'claude',
    rateLimitMaxRequests: 1_000,
    rateLimitWindowMs: 60_000,
  });
```

### Langfuse

[Langfuse](https://langfuse.com/) is an AI observability platform that provides insights into your AI usage.
The `use-ai` `AISDKAgent` supports this out of the box, just set these environment variables:

```bash
LANGFUSE_PUBLIC_KEY='your-langfuse-public-key'
LANGFUSE_SECRET_KEY='your-langfuse-secret-key'
```

### Feedback

Enable thumbs up/down feedback buttons on AI messages to collect user ratings. Feedback is submitted to Langfuse as scores linked to the corresponding trace.

**Server setup:**

The plugin reads Langfuse credentials from `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` environment variables by default.

If these are set, the `FeedbackPlugin` will be enabled automatically.

**Client setup:**

The built-in chat UI includes feedback buttons automatically when the server has `FeedbackPlugin` enabled.

### Bundled Client Library (optional)

If you have dependency conflicts (e.g. `zod 4.0+`), you can use the bundled version of `@meetsmore-oss/use-ai-client` instead:

```ts
  // Default: tree-shakeable, smaller if you already have deps
  import { useAI, defineTool } from '@meetsmore-oss/use-ai-client';

  // Bundled: self-contained, no zod/socket.io version conflicts
  import { useAI, defineTool } from '@meetsmore-oss/use-ai-client/bundled';
```

Note that this is much larger (206 KB gzipped) than the unbundled dependency (16 KB gzipped).

## Plugins

`@meetsmore-oss/use-ai-server` has a plugin architecture allowing you to extend the AG-UI protocol and add more handlers.

```typescript
export interface UseAIServerPlugin {
  /**
   * Returns the unique identifier for this plugin.
   * Used for logging and debugging purposes.
   *
   * @returns Plugin name (e.g., 'workflows', 'analytics', 'auth')
   */
  getName(): string;

  /**
   * Called when the plugin is registered with the server.
   * Use this to register custom message handlers.
   *
   * @param server - Object with registerMessageHandler method
   */
  registerHandlers(server: {
    registerMessageHandler(type: string, handler: MessageHandler): void;
  }): void;

  /**
   * Optional lifecycle hook called when a client connects.
   *
   * @param session - The newly created client session
   */
  onClientConnect?(session: ClientSession): void;

  /**
   * Optional lifecycle hook called when a client disconnects.
   *
   * @param session - The disconnecting client session
   */
  onClientDisconnect?(session: ClientSession): void;

  /**
   * Optional hook called before an agent run starts. Useful for things like authentication or quota enforcement.
   * Return `{ abort: true, message: '...' }` to block the run.
   */
  beforeRunAgent?(input: AgentInput): Promise<BeforeRunAgentResult | void>;
}
```

This is primarily used to avoid polluting the main library with the code used for providing workflow runners (see `@meetsmore-oss/use-ai-plugin-workflows`)

### `@meetsmore-oss/use-ai-plugin-workflows`

`@meetsmore-oss/use-ai-plugin-workflows` provides the capability for running workflows using AI workflow engines like Dify.

Only `DifyWorkflowRunner` is supported for now, but you can write your own Runners very easily (feel free to open a PR).

```typescript
  const server = new UseAIServer({
    port: 8081,
    agents: {
      'claude': new AISDKAgent({ /** see AISDKAgent for an example */ })
    },
    defaultAgent: 'claude',
    plugins: [
      new WorkflowsPlugin({
        runners: new Map([
          ['dify', new DifyWorkflowRunner({
            apiBaseUrl: process.env.DIFY_API_URL,
            workflows: {
              'greeting-workflow': 'get-this-value-from-dify'
            }
          })]
        ])
      })
    ]
  });
```

```tsx
  // define an existing `dify` workflow.
  const { trigger, status, text, error, connected } = useAIWorkflow('dify', 'greeting-workflow');

  // Trigger the workflow.
  await trigger({
    inputs: {
      username: 'Alice',
    },
    tools: {
      displayGreeting: defineTool(
        'Display a greeting message to the user',
        z.object({
          greeting: z.string().describe('The greeting message to display'),
        }),
        (input) => {
          addLog(`Tool called: displayGreeting`);
          setProcessedItems((prev) => [...prev, input.greeting]);
          return { success: true };
        }
      ),
    },
    onProgress: (progress) => {
      addLog(`Progress: ${progress.status}${progress.text ? ` - ${progress.text}` : ''}`);
    },
    onComplete: (result) => {
      addLog('Workflow completed!');
    },
    onError: (err) => {
      addLog(`Error: ${err.message}`);
    },
  });
```

Because it's awkward to get API keys for workflows from Dify, you can use a mapping of names -> API keys:

```typescript
    plugins: [
      new WorkflowsPlugin({
        runners: new Map([
          ['dify', new DifyWorkflowRunner({
            apiBaseUrl: process.env.DIFY_API_URL,
            workflows: {
              'greeting-workflow': 'x7a$978s998290abhdg' // memorable name -> dify API key value
            }
          })]
        ])
      })
    ]
```

```tsx
  const { trigger, status, text, error, connected } = useAIWorkflow('dify', 'greeting-workflow');
```

## Skills

This repository provides an [agent skill](https://agentskills.io/home) for developers building applications with use-ai. The skill includes auto-generated API documentation, allowing AI coding agents to reference it for accurate usage guidance.

You can install the skill with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/meetsmore/use-ai/main/scripts/install-skill.sh | bash
```

To install a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/meetsmore/use-ai/main/scripts/install-skill.sh | USE_AI_VERSION=1.7.0 bash
```

This script clones the repository, builds the API docs locally, and installs the skill via `npx skills add`. It requires `git`, `bun`, and `npx` to be installed.

You will be prompted to choose between project-local or global installation.
