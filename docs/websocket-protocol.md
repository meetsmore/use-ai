# Plain WebSocket protocol

The client reaches the server through a `UseAITransport`. `SocketIOTransport` is the default. `WebSocketTransport` is the alternative. It carries AG-UI events as JSON text frames over a plain WebSocket.

Use `WebSocketTransport` to connect the `use-ai` chat UI and hooks to your own server. Your server does not have to be Node. It does not have to serve Socket.IO. It must accept a WebSocket connection. It must then exchange the frames that this document defines.

## Client

```tsx
import { UseAIProvider, WebSocketTransport } from '@meetsmore-oss/use-ai-client';

root.render(
  <UseAIProvider transport={new WebSocketTransport('wss://your-server.com')}>
    <App />
  </UseAIProvider>
);
```

Give the provider `serverUrl` or `transport`, not both. `serverUrl` connects over Socket.IO. `transport` connects over the transport that you pass.

The provider reads `transport` once, on the first render. An inline object therefore does not reconnect the client on each render. To change transports, remount the provider.

## Bundled server

The bundled server serves one transport. The default is Socket.IO.

```typescript
const server = new UseAIServer({
  agents: { claude },
  defaultAgent: 'claude',
  transport: 'websocket', // default: 'socketio'
});
```

With `transport: 'websocket'`, the server accepts WebSocket upgrades at `/`. It does not serve Socket.IO. The `/health` endpoint is unchanged.

The Docker image reads the same setting from the `TRANSPORT` environment variable.

## Encoding

Each frame is one JSON object, as a text frame. JSON is the encoding that AG-UI, MCP and the OpenAI Realtime API use on their wires. AG-UI also defines a protobuf encoding for bandwidth. This protocol does not use it.

## Upstream frames

The client sends each `UseAIClientMessage` as one frame, with nothing around it.

```json
{ "type": "run_agent", "data": { "threadId": "...", "runId": "...", "messages": [], "tools": [], "state": null, "forwardedProps": {} } }
```

The message types are:

- `run_agent`
- `tool_result`
- `tool_approval_response`
- `abort_run`
- `message_feedback`

Plugins add more. See `UseAIClientMessage` in `@meetsmore-oss/use-ai-core` for each payload.

## Downstream frames

The server sends one AG-UI event per frame. Each event has a `type` field.

```json
{ "type": "RUN_STARTED", "threadId": "...", "runId": "...", "timestamp": 1700000000000 }
{ "type": "TEXT_MESSAGE_CONTENT", "messageId": "...", "delta": "Hello" }
{ "type": "RUN_FINISHED", "threadId": "...", "runId": "..." }
```

Two payloads are not AG-UI events. The server sends them as AG-UI `CUSTOM` events, once, after the connection opens.

```json
{ "type": "CUSTOM", "name": "agents", "value": { "agents": [{ "id": "claude", "name": "Claude" }], "defaultAgent": "claude" } }
{ "type": "CUSTOM", "name": "config", "value": { "langfuseEnabled": true } }
```

| Name     | Value                                              | Required |
| -------- | -------------------------------------------------- | -------- |
| `agents` | The agent list and the default agent id            | Yes      |
| `config` | Capability flags, such as `langfuseEnabled`        | No       |

The client ignores an event type that it does not handle. It also ignores a `CUSTOM` name that it does not know. A server can therefore add events without a change to older clients.

The client handles these event types:

- `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`
- `STEP_STARTED`, `STEP_FINISHED`
- `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`
- `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_RESULT`
- `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`, `REASONING_ENCRYPTED_VALUE`
- `TOOL_APPROVAL_REQUEST`, a `use-ai` extension

See the [AG-UI protocol](https://docs.ag-ui.com/introduction) for each event. See `packages/core/src/types.ts` for the types that this library uses.

## One turn, step by step

1. The client opens the connection.
2. The server sends `agents`. It then sends `config`.
3. The client sends `run_agent` with the prompt, the tool definitions and the app state.
4. The server sends `RUN_STARTED`. It then streams the model output.
5. For a client-side tool, the server sends `TOOL_CALL_START`, `TOOL_CALL_ARGS` and `TOOL_CALL_END`.
6. The client runs the tool. It then sends `tool_result` with the output.
7. The server resumes the model. It then streams the rest of the output.
8. The server sends `RUN_FINISHED`.

## Reconnection

`WebSocketTransport` reconnects through [partysocket](https://github.com/partykit/partykit/tree/main/packages/partysocket). It retries indefinitely. The delay doubles after each attempt, from one second up to ten seconds. The limits match `SocketIOTransport`, so a mobile app in the background, or a device in airplane mode, recovers without frequent retries.

Set both delays in the options:

```typescript
new WebSocketTransport('wss://your-server.com', {
  reconnectionDelay: 1000,     // first retry, in milliseconds
  reconnectionDelayMax: 10000, // upper bound, in milliseconds
});
```

The server destroys the session when the connection closes. A reconnected client therefore starts a new session. The client sends its conversation history with the next `run_agent`.

## Your own transport

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
