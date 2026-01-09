# Getting Started with AG-UI Integrations

## What is an Integration?

An AG-UI integration makes your agent speak the AG-UI protocol. This means your agent can work with any AG-UI compatible client application - like chat interfaces, copilots, or custom AI tools.

Think of it like adding a universal translator to your agent. Instead of building custom APIs for each client, you implement AG-UI once and instantly work with any compatible application.

## Capabilities

Agents integrating with AG-UI can:

- **Stream responses** - Real-time text that appears as it's generated
- **Call client-side tools** - Your agent can use functions and services defined by clients
- **Share state** - Your agent's state is bidirectionally shared
- **Execute universally** - Integrate with any AG-UI compatible client application

## When to Make an Integration

If the integration you're looking for is not listed on the integrations page, you'll need to make an integration.

However, if you're looking to utilize an existing integration (like LangGraph, CrewAI, Mastra, etc.), you can skip this step and go straight to building an application.

## Types of Integrations

### Server Implementation

Emit AG-UI events directly from your agent or server.

Best for:
- Building new agent frameworks from scratch
- Maximum control over how and what events are emitted
- Exposing your agent as a standalone API

See: [Server Implementation](./server.md)

### Middleware Implementation

Translate existing protocols and applications to AG-UI events.

Best for:
- Taking your existing protocol/API and translating it universally
- Working within the confines of an existing system or framework
- When you don't have direct control over the agent framework

## Quick Decision Guide

| Scenario | Recommendation |
|----------|----------------|
| Building a new agent from scratch | Server Implementation |
| Want maximum control over events | Server Implementation |
| Have an existing API to wrap | Middleware Implementation |
| Using an existing framework | Middleware Implementation |
| Framework already supports AG-UI | Use existing integration |

## Next Steps

1. Choose your implementation type
2. Follow the appropriate guide:
   - [Server Implementation](./server.md)
   - [Client Implementation](./clients.md)
3. Test with an AG-UI compatible client like CopilotKit

## Source

https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/quickstart/introduction.mdx
