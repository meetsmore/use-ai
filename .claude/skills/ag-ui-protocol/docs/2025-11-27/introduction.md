# The Agent-User Interaction (AG-UI) Protocol

AG-UI is an **open**, **lightweight**, **event-based** protocol that standardizes how AI agents connect to user-facing applications.

Built for simplicity and flexibility, it standardizes how agent state, UI intents, and user interactions flow between your model/agent runtime and user-facing frontend applications—to allow application developers to ship reliable, debuggable, user-friendly agentic features fast while focusing on application needs and avoiding complex ad-hoc wiring.

## Building Blocks

- **Streaming chat** - Live token and event streaming for responsive multi turn sessions, with cancel and resume
- **Multimodality** - Typed attachments and real time media (files, images, audio, transcripts); supports voice, previews, annotations, provenance
- **Generative UI, static** - Render model output as stable, typed components under app control
- **Generative UI, declarative** - Small declarative language for constrained yet open-ended agent UIs
- **Shared state** - (Read-only & read-write) Typed store shared between agent and app
- **Thinking steps** - Visualize intermediate reasoning from traces and tool events
- **Frontend tool calls** - Typed handoffs from agent to frontend-executed actions, and back
- **Backend tool rendering** - Visualize backend tool outputs in app and chat
- **Interrupts (human in the loop)** - Pause, approve, edit, retry, or escalate mid flow without losing state
- **Sub-agents and composition** - Nested delegation with scoped state, tracing, and cancellation
- **Agent steering** - Dynamically redirect agent execution with real-time user input
- **Tool output streaming** - Stream tool results and logs so UIs can render long-running effects in real time
- **Custom events** - Open-ended data exchange for needs not covered by the protocol

## Why Agentic Apps Need AG-UI

Agentic applications break the simple request/response model that dominated frontend-backend development in the pre-agentic era.

### The Requirements of User-Facing Agents

While agents are just software, they exhibit characteristics that make them challenging to serve behind traditional REST/GraphQL APIs:

- Agents are **long-running** and **stream** intermediate work—often across multi-turn sessions
- Agents are **nondeterministic** and can **control application UI nondeterministically**
- Agents simultaneously mix **structured + unstructured IO** (e.g. text & voice, alongside tool calls and state updates)
- Agents need user-interactive **composition**: e.g. they may call sub-agents, often recursively

AG-UI is an event-based protocol that enables dynamic communication between agentic frontends and backends. It builds on top of the foundational protocols of the web (HTTP, WebSockets) as an abstraction layer designed for the agentic age.

## The AI Protocol Landscape

AG-UI has emerged as the 3rd leg of the AI protocol landscape:

- **MCP** - Connects agents to tools and context
- **A2A** - Connects agents to other agents
- **AG-UI** - Connects agents to users (through user-facing applications)

These protocols are complementary and have distinct technical goals; a single agent can and often does use all 3 simultaneously.

## Supported Integrations

### Agent Frameworks - Partnerships

| Framework | Status |
|-----------|--------|
| LangGraph | Supported |
| CrewAI | Supported |

### Agent Frameworks - 1st Party

| Framework | Status |
|-----------|--------|
| Microsoft Agent Framework | Supported |
| Google ADK | Supported |
| Mastra | Supported |
| Pydantic AI | Supported |
| Agno | Supported |
| LlamaIndex | Supported |
| AG2 | Supported |
| AWS Bedrock Agents | In Progress |
| AWS Strands Agents | In Progress |

### Agent Frameworks - Community

| Framework | Status |
|-----------|--------|
| Vercel AI SDK | Supported |
| OpenAI Agent SDK | In Progress |
| Cloudflare Agents | In Progress |

### SDKs

| SDK | Status |
|-----|--------|
| TypeScript | Supported |
| Python | Supported |
| Kotlin | Supported |
| Golang | Supported |
| Dart | Supported |
| Java | Supported |
| Rust | Supported |
| .NET | In Progress |

### Clients

| Client | Status |
|--------|--------|
| CopilotKit | Supported |
| Terminal + Agent | Supported |
| React Native | Help Wanted |

## Source

https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/introduction.mdx
