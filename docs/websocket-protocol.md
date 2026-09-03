# Plain WebSocket protocol

The bundled server serves Socket.IO by default. It also serves a plain WebSocket
listener on the same port, at `/ws`. A client reaches that listener with
`WebSocketTransport` instead of the default `SocketIOTransport`.

Use this protocol to connect the `use-ai` chat UI and hooks to your own server.
Your server does not have to be Node. It does not have to implement Socket.IO.
Your server must accept a WebSocket connection. It must then exchange the JSON text
frames below.

## Client setup

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

The provider reads `transport` once, on the first render. An inline object therefore
does not reconnect the client on every render. To change transports, remount the provider.

When you pass a transport, the provider does not use `serverUrl`. The prop stays
required. The provider reports `serverUrl` on the context for application code that
reads it.

## Server setup

The bundled server enables the listener by default:

```typescript
const server = new UseAIServer({
  agents: { claude },
  defaultAgent: 'claude',
  webSocketPath: '/agent',  // default: '/ws'. Pass null to serve Socket.IO only.
});
```

## Upstream frames

The client sends the `UseAIClientMessage` object, serialized, with nothing wrapped
around it. Each message is one text frame.

```json
{ "type": "run_agent", "data": { "threadId": "...", "runId": "...", "messages": [], "tools": [], "state": null, "forwardedProps": {} } }
```

The message types are `run_agent`, `tool_result`, `tool_approval_response`,
`abort_run` and `message_feedback`. Plugins add more. See `UseAIClientMessage` in
`@meetsmore-oss/use-ai-core` for each payload.

## Downstream frames

A plain WebSocket has no event names of its own, so the server wraps each payload in
a named envelope. Each envelope is one text frame.

```json
{ "name": "event",  "data": { "type": "TEXT_MESSAGE_CONTENT", "messageId": "...", "delta": "Hello" } }
{ "name": "agents", "data": { "agents": [{ "id": "claude", "name": "Claude" }], "defaultAgent": "claude" } }
{ "name": "config", "data": { "langfuseEnabled": true } }
```

| Name     | Payload                                            | When                                                   |
| -------- | -------------------------------------------------- | ------------------------------------------------------ |
| `agents` | The agent list and the default agent id            | Once, after connect                                    |
| `config` | Server capability flags, such as `langfuseEnabled` | Once, after connect, if the server has flags to report |
| `event`  | One AG-UI event                                    | Throughout a run                                       |

The client reads `name` and finds the handlers for that name. It then passes `data`
to each handler.

The client ignores a frame with an unknown `name`. An unknown name is not an error.
The client does not close the connection. A server can therefore send a name that an
older client does not know.

The `event` payload is an AG-UI event. The event types the client handles are
`RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `STEP_STARTED`, `STEP_FINISHED`,
`TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `TOOL_CALL_START`,
`TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_RESULT`, the `REASONING_*` events, and
the `TOOL_APPROVAL_REQUEST` extension. See the
[AG-UI protocol](https://docs.ag-ui.com/introduction) for each event, and
`packages/core/src/types.ts` for the types this library uses.

## One turn, step by step

1. The client opens the connection.
2. The server sends `agents`. It then sends `config`.
3. The client sends `run_agent` with the prompt, the tool definitions and the app state.
4. The server sends `event` frames for `RUN_STARTED`, then the model output.
5. For a client-side tool, the server sends `TOOL_CALL_START`, `TOOL_CALL_ARGS` and `TOOL_CALL_END`.
6. The client runs the tool. It then sends `tool_result` with the output.
7. The server resumes the model. It then sends the remaining `event` frames.
8. The server sends `RUN_FINISHED`.

## Reconnection

A plain WebSocket has no reconnection. `WebSocketTransport` therefore runs its own
retry loop. It retries indefinitely, with exponential backoff capped at ten seconds.
The cap matches the Socket.IO settings. A mobile app in the background, or a device
in airplane mode, thus recovers without frequent retries.

Set both delays in the options:

```typescript
new WebSocketTransport('wss://your-server.com/ws', {
  reconnectionDelay: 1000,     // first retry, in milliseconds
  reconnectionDelayMax: 10000, // cap on the backoff, in milliseconds
});
```

The server destroys the session when the connection closes. A reconnected client
therefore starts a new session. The client sends its conversation history with the
next `run_agent`.

## Writing your own transport

`UseAITransport` has five members:

- `connect`
- `disconnect`
- `send`
- `on`
- `connected`

Implement `UseAITransport` to carry the same messages over something else.

```typescript
import { UseAIClient, type UseAITransport } from '@meetsmore-oss/use-ai-client';

const client = new UseAIClient(myTransport);
```
