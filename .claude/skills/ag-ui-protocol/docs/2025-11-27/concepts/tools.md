# Tools

Tools in AG-UI are functions enabling AI agents to interact with external systems and incorporate human judgment. They bridge AI reasoning with real-world actions, allowing developers to create sophisticated human-in-the-loop experiences.

## Core Functionality

Tools allow agents to:
- Request specific information
- Perform actions in external systems
- Ask for human input or confirmation
- Access specialized capabilities

## Tool Structure

Each tool follows a consistent format:

```typescript
interface Tool {
  name: string;           // Unique identifier
  description: string;    // Explanation of purpose
  parameters: JSONSchema; // JSON Schema defining accepted arguments
}
```

### Example Tool Definition

```typescript
const confirmAction = {
  name: "confirmAction",
  description: "Ask the user to confirm a specific action before proceeding",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "The action that needs user confirmation"
      },
      importance: {
        type: "string",
        enum: ["low", "medium", "high", "critical"],
        description: "The importance level of the action"
      },
      details: {
        type: "string",
        description: "Additional details about the action"
      }
    },
    required: ["action"]
  }
};
```

## Frontend-Defined Tools

A key architectural advantage: the frontend determines what capabilities are available to the agent. Tools can dynamically adjust based on:
- User permissions
- Application state
- Context and environment

```typescript
// Running an agent with tools from the frontend
agent.runAgent({
  tools: [confirmAction, searchTool, calculateTool],
  // other parameters
});
```

## Tool Call Lifecycle

The system follows three phases:

### 1. TOOL_CALL_START

Initiates the call with unique ID:

```typescript
{
  type: "TOOL_CALL_START",
  toolCallId: "tc_123",
  toolCallName: "get_weather"
}
```

### 2. TOOL_CALL_ARGS

Streams arguments as JSON fragments:

```typescript
{
  type: "TOOL_CALL_ARGS",
  toolCallId: "tc_123",
  delta: '{"location":'
}
{
  type: "TOOL_CALL_ARGS",
  toolCallId: "tc_123",
  delta: '"London"}'
}
```

### 3. TOOL_CALL_END

Marks completion:

```typescript
{
  type: "TOOL_CALL_END",
  toolCallId: "tc_123"
}
```

## Tool Result Handling

After the frontend executes a tool, it returns results via a tool message:

```typescript
{
  id: "msg_456",
  role: "tool",
  toolCallId: "tc_123",
  content: JSON.stringify({
    temperature: 18,
    conditions: "partly cloudy",
    humidity: 65
  })
}
```

## Human-in-the-Loop Integration

Tools enable workflows where:
- AI suggests actions that require human approval
- Collaborative decision-making between agents and users
- Humans can review, modify, or reject agent proposals

### Example: Approval Workflow

```typescript
const approveTransaction = {
  name: "approveTransaction",
  description: "Request user approval for a financial transaction",
  parameters: {
    type: "object",
    properties: {
      amount: { type: "number", description: "Transaction amount" },
      recipient: { type: "string", description: "Recipient name" },
      reason: { type: "string", description: "Transaction reason" }
    },
    required: ["amount", "recipient"]
  }
};

// Frontend handles the tool call
function handleToolCall(toolCall) {
  if (toolCall.name === "approveTransaction") {
    // Show approval dialog to user
    const approved = await showApprovalDialog(toolCall.arguments);
    return { approved, timestamp: Date.now() };
  }
}
```

## Best Practices

### Clear Naming

Use descriptive, action-oriented names:
- Good: `searchProducts`, `createInvoice`, `confirmDeletion`
- Avoid: `tool1`, `doThing`, `process`

### Detailed Descriptions

Provide context for the AI to understand when to use the tool:

```typescript
{
  name: "sendEmail",
  description: "Send an email to a specified recipient. Use this when the user explicitly asks to send an email or when a workflow requires email notification. Always confirm the recipient and content before sending."
}
```

### Structured Parameters

Use JSON Schema for robust argument validation:

```typescript
{
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "Search query"
      },
      filters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["books", "electronics", "clothing"] },
          priceMax: { type: "number", minimum: 0 }
        }
      }
    },
    required: ["query"]
  }
}
```

### Robust Error Handling

Return meaningful errors that help the agent recover:

```typescript
// Good error response
{
  error: true,
  code: "INVALID_RECIPIENT",
  message: "Email address is not valid",
  suggestion: "Please provide a valid email address in the format user@domain.com"
}
```

## Source

https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/tools.mdx
