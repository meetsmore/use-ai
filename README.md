# @use-ai

[![CI](https://github.com/meetsmore/use-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/meetsmore/use-ai/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@meetsmore/use-ai-client)](https://www.npmjs.com/package/@meetsmore/use-ai-client)
[![npm](https://img.shields.io/npm/v/@meetsmore/use-ai-server)](https://www.npmjs.com/package/@meetsmore/use-ai-server)
[![Docker](https://img.shields.io/badge/Docker-ghcr.io%2Fmeetsmore%2Fuse--ai--server-blue?logo=docker)](https://github.com/meetsmore/use-ai/pkgs/container/use-ai-server)
[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

A React client/framework for easily enabling AI to control your users frontend.

<img width="1137" height="817" alt="image" src="https://github.com/user-attachments/assets/e8dd5176-cca0-4104-9342-a6dea914f0f8" />

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
    - [`confirmationRequired`](#confirmationrequired)
    - [Chat History](#chat-history)
    - [Error Code Mapping](#error-code-mapping)
    - [Using the AI directly (without chat UI)](#using-the-ai-directly-without-chat-ui)
    - [Custom UI](#custom-ui)
    - [Slash Commands](#slash-commands)
    - [File Upload](#file-upload)
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
  - [Plugins](#plugins)
    - [`@meetsmore/use-ai-plugin-workflows`](#meetsmore-use-ai-plugin-workflows)
    - [`@meetsmore/use-ai-plugin-mastra`](#meetsmore-use-ai-plugin-mastra)

## Overview

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
3. `@meetsmore/use-ai-server` acts as a co-ordinator between your frontend and an LLM.
4. ✨ The LLM can now call your `tools` functions in the frontend as MCPs.

## Installation

### Frontend

```bash
bun add @meetsmore/use-ai-client
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
      # - ANTHROPIC_MODEL=claude-sonnet-4-20250514
      # - OPENAI_MODEL=gpt-4-turbo

      # Optional: Server configuration
      # - PORT=8081
      # - LOG_FORMAT=json
      # - RATE_LIMIT_MAX_REQUESTS=0
      # - RATE_LIMIT_WINDOW_MS=60000

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
bun add @meetsmore/use-ai-server
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
docker run -d -p 8081:8081 -e ANTHROPIC_API_KEY='your-api-key' ghcr.io/meetsmore/use-ai-server:latest
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
│   ├── plugin-mastra            # Mastra workflow agent plugin
│   ├── plugin-workflows         # headless workflow execution plugin
│   ├── plugin-workflows-client  # client hooks for workflows
│   └── server                   # backend server library
```

# Features

## General

### AG-UI Protocol

`@use-ai` partially implements the [AG-UI protocol](https://docs.ag-ui.com/introduction) for communication between `@meetsmore/use-ai-client` and `@meetsmore/use-ai-server`.

Not all aspects of AG-UI protocol are implemented now, but it feel free to open a PR to add any parts of the protocol you need.

There are some minor extensions to the protocol:

**Message Types**:
- `run_workflow`: Trigger headless workflow (use-ai extension) [see `@meetsmore/use-ai-plugin-workflows`]

## Client

### `useAI` hook

The fundamental building block for adding AI capabilities to any React component:

```tsx
import { useAI, defineTool } from '@meetsmore/use-ai-client';
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
import { UseAIProvider } from '@meetsmore/use-ai-client';

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

### `confirmationRequired`

For destructive operations, use `confirmationRequired`:

```tsx
const deleteAccount = defineTool(
  'Delete this user\'s account permanently',
  () => { /* deletion logic */ },
  { confirmationRequired: true }
);
```

This will try its best to get the AI to request confirmation from the user via chat before taking action.

### Chat History

By default, there is locally stored chat history for up to 20 chats.

The user can switch between them and resume old chats.

If you wanted to have chats stored on the server, with the users account, you can provide your own `ChatRepository` implementation to do that:

```tsx
import { UseAIProvider } from '@meetsmore/use-ai-client';

root.render(
  <UseAIProvider
    serverUrl="wss://your-server.com"
    chatRepository={{new MyChatRepository()}} // define your own chat repository for storing history.
  >
    <App />
  </UseAIProvider>
);
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
import { UseAIProvider } from '@meetsmore/use-ai-client';

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
import { UseAIProvider } from '@meetsmore/use-ai-client';

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

You can also disable them by passing `null`:

```tsx
import { UseAIProvider } from '@meetsmore/use-ai-client';

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

### Theme Customization

Customize the chat UI appearance:

```tsx
<UseAIProvider
  serverUrl="ws://localhost:8081"
  theme={{
    colors: { primary: '#007bff', background: '#ffffff' },
    borderRadius: '8px',
  }}
>
```

### Internationalization

Localize UI strings:

```tsx
<UseAIProvider
  serverUrl="ws://localhost:8081"
  strings={{
    sendButton: 'Envoyer',
    placeholder: 'Tapez votre message...',
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

For most use cases, you can just use `@meetsmore/use-ai-server` as-is, and customize only the environment variables:

```bash
# AI Provider (at least one required)
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# ANTHROPIC_MODEL=claude-sonnet-4-20250514
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

# Mastra Workflow Agent (optional)
# MASTRA_URL=http://localhost:4111

# Rate Limiting (optional)
# RATE_LIMIT_MAX_REQUESTS=0
# RATE_LIMIT_WINDOW_MS=60000

# Langfuse Observability (optional)
# LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

### `UseAIServer`

If you want to integrate the `use-ai` server into your existing server, for example if you don't want to deploy another instance in your infrastructure, or you want to use some capabilities in your existing server, you can use `@meetsmore/use-ai-server` as a library and run an instance of `UseAIServer`:

```typescript
import { UseAIServer, AISDKAgent } from '@meetsmore/use-ai-server';
import { anthropic } from '@ai-sdk/anthropic';

const server = new UseAIServer({
  port: 8081,
  agents: {
    'claude': new AISDKAgent({
      model: anthropic('claude-sonnet-4-20250514'),
      name: 'Claude',
      annotation: 'Powered by Anthropic', // shown in agent selector UI
    })
  },
  defaultAgent: 'claude',
  rateLimitMaxRequests: 1_000,
  rateLimitWindowMs: 60_000,
  plugins: [              // see 'Plugins'
    new WorkflowsPlugin({ /** see @meetsmore/use-ai-plugin-workflows */})
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

To configure these in `@meetsmore/use-ai-server`, you can use the environment variables:

```bash
# MCP_ENDPOINT_YOURMCPNAME_URL=http://localhost:3002
# MCP_ENDPOINT_YOURMCPNAME_NAMESPACE=yourmcpname  # Optional, defaults to "yourmcpname"
# MCP_ENDPOINT_YOURMCPNAME_TIMEOUT=60000          # Optional, defaults to 30000
# MCP_ENDPOINT_YOURMCPNAME_TOOLS_CACHE_TTL=60000  # Optional, cache tool definitions

# multiple endpoints are supported
# MCP_ENDPOINT_ANOTHERMCP_URL=http://localhost:3003
```

If your MCP tools need auth (e.g. you want to do things on behalf of the user, in the backend), you can use the `@meetsmore/use-ai-client` `mcpHeadersProvider` prop to do that:

```tsx
import { UseAIProvider } from '@meetsmore/use-ai-client';

root.render(
  <UseAIProvider
    serverUrl="ws://localhost:8081"
    mcpHeadersProvider={() => ({
      'http://localhost:3002/*': {        // when any URL matching this pattern is called by the server for MCPs....
        headers: { 'X-API-Key': 'secret-api-key-123' },   // add these headers to the request.
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

### Rate Limiting

`UseAIServer` supports rate limiting by IP.
This allows you to implement `use-ai` without auth, and just rely on rate limiting to prevent abuse of your token spend.

You can configure it using environment variables if using `@meetsmore/use-ai-server` directly:

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

### Bundled Client Library (optional)

If you have dependency conflicts (e.g. `zod 4.0+`), you can use the bundled version of `@meetsmore/use-ai-client` instead:

```ts
  // Default: tree-shakeable, smaller if you already have deps
  import { useAI, defineTool } from '@meetsmore/use-ai-client';

  // Bundled: self-contained, no zod/socket.io version conflicts
  import { useAI, defineTool } from '@meetsmore/use-ai-client/bundled';
```

Note that this is much larger (206 KB gzipped) than the unbundled dependency (16 KB gzipped).

## Plugins

`@meetsmore/use-ai-server` has a plugin architecture allowing you to extend the AG-UI protocol and add more handlers.

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
}
```

This is primarily used to avoid polluting the main library with the code used for providing workflow runners (see `@meetsmore/use-ai-plugin-workflows`)

### `@meetsmore/use-ai-plugin-workflows`

`@meetsmore/use-ai-plugin-workflows` provides the capability for running workflows using AI workflow engines like Dify.

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

### `@meetsmore/use-ai-plugin-mastra`

`@meetsmore/use-ai-plugin-mastra` provides a `MastraWorkflowAgent` that runs Mastra workflows as conversational agents.

```typescript
import { MastraWorkflowAgent } from '@meetsmore/use-ai-plugin-mastra';

const server = new UseAIServer({
  agents: {
    'mastra-agent': new MastraWorkflowAgent({
      workflowId: 'my-workflow',
      agentName: 'My Mastra Agent',
      annotation: 'Powered by Mastra',
    })
  },
  defaultAgent: 'mastra-agent',
});
```

Set `MASTRA_URL` environment variable to configure the Mastra server endpoint.
