# Messages

Messages form the backbone of communication in the AG-UI protocol, representing conversation history between users and AI agents while maintaining compatibility across different AI providers.

## Message Types

The system defines six message roles:

### User Messages

Support both plain text and multimodal content (images, audio, files):

```typescript
interface UserMessage {
  id: string;
  role: "user";
  content: string | MultimodalContent[];
}
```

### Assistant Messages

Can include optional text and tool calls:

```typescript
interface AssistantMessage {
  id: string;
  role: "assistant";
  content?: string;
  toolCalls?: ToolCall[];
}
```

### System Messages

Provide instructions or context:

```typescript
interface SystemMessage {
  id: string;
  role: "system";
  content: string;
}
```

### Tool Messages

Contain execution results linked to specific tool calls:

```typescript
interface ToolMessage {
  id: string;
  role: "tool";
  toolCallId: string;
  content: string;
}
```

### Activity Messages

Structured progress updates rendered by frontends:

```typescript
interface ActivityMessage {
  id: string;
  role: "activity";
  activity: ActivityData;
}
```

### Developer Messages

Internal debugging communication:

```typescript
interface DeveloperMessage {
  id: string;
  role: "developer";
  content: string;
}
```

## Streaming Architecture

Messages support three-phase streaming for real-time responsiveness:

```typescript
// Phase 1: Start
{ type: "TEXT_MESSAGE_START", messageId: "msg1", role: "assistant" }

// Phase 2: Content chunks
{ type: "TEXT_MESSAGE_CONTENT", messageId: "msg1", delta: "Hello " }
{ type: "TEXT_MESSAGE_CONTENT", messageId: "msg1", delta: "there!" }

// Phase 3: End
{ type: "TEXT_MESSAGE_END", messageId: "msg1" }
```

## Tool Integration

Tool calls are embedded in assistant messages, with results returned via tool messages:

```typescript
// Assistant message with tool call
{
  id: "msg1",
  role: "assistant",
  toolCalls: [{
    id: "tc1",
    name: "get_weather",
    arguments: { location: "London" }
  }]
}

// Tool result message
{
  id: "msg2",
  role: "tool",
  toolCallId: "tc1",
  content: JSON.stringify({ temperature: 18, conditions: "cloudy" })
}
```

This creates a traceable chain of actions between the agent and tools.

## Synchronization

Two mechanisms handle message sync:

### Messages Snapshot

Complete snapshot for initialization and major state changes:

```typescript
{
  type: "MESSAGES_SNAPSHOT",
  messages: [
    { id: "1", role: "user", content: "Hello" },
    { id: "2", role: "assistant", content: "Hi there!" }
  ]
}
```

### Streaming

Ongoing interactions use the three-phase streaming pattern for real-time updates.

## Multimodal Content

User messages can include various content types:

```typescript
interface MultimodalContent {
  type: "text" | "image" | "audio" | "file";
  // Type-specific fields
}

// Example with image
{
  id: "msg1",
  role: "user",
  content: [
    { type: "text", text: "What's in this image?" },
    { type: "image", url: "https://example.com/image.png" }
  ]
}
```

## Best Practices

1. **Unique IDs** - Always use unique message IDs for tracking
2. **Tool Call References** - Tool messages must reference the correct `toolCallId`
3. **Streaming** - Use streaming for long responses to improve UX
4. **Snapshots** - Use snapshots for initialization, streaming for updates

## Source

https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/messages.mdx
