# Middleware

Middleware in AG-UI provides a powerful way to transform, filter, and augment the event streams that flow through agents. It enables you to add cross-cutting concerns like logging, authentication, rate limiting, and event filtering without modifying the core agent logic.

## What is Middleware?

Middleware sits between the agent execution and the event consumer, allowing you to:

1. **Transform events** - Modify or enhance events as they flow through
2. **Filter events** - Selectively allow or block certain events
3. **Add metadata** - Inject additional context or tracking information
4. **Handle errors** - Implement custom error recovery strategies
5. **Monitor execution** - Add logging, metrics, or debugging capabilities

## How Middleware Works

Middleware forms a chain where each middleware wraps the next, creating layers of functionality:

```typescript
import { AbstractAgent } from "@ag-ui/client"

const agent = new MyAgent()

// Middleware chain: logging -> auth -> filter -> agent
agent.use(loggingMiddleware, authMiddleware, filterMiddleware)

// Events flow through all middleware
await agent.runAgent()
```

## Function-Based Middleware

For simple transformations:

```typescript
import { MiddlewareFunction } from "@ag-ui/client"
import { EventType } from "@ag-ui/core"
import { map } from "rxjs/operators"

const prefixMiddleware: MiddlewareFunction = (input, next) => {
  return next.run(input).pipe(
    map(event => {
      if (event.type === EventType.TEXT_MESSAGE_CHUNK) {
        return {
          ...event,
          delta: `[AI]: ${event.delta}`
        }
      }
      return event
    })
  )
}

agent.use(prefixMiddleware)
```

## Class-Based Middleware

For complex scenarios requiring state or configuration:

```typescript
import { Middleware } from "@ag-ui/client"
import { Observable } from "rxjs"
import { tap, finalize } from "rxjs/operators"

class MetricsMiddleware extends Middleware {
  private eventCount = 0

  constructor(private metricsService: MetricsService) {
    super()
  }

  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    const startTime = Date.now()

    return next.run(input).pipe(
      tap(event => {
        this.eventCount++
        this.metricsService.recordEvent(event.type)
      }),
      finalize(() => {
        const duration = Date.now() - startTime
        this.metricsService.recordDuration(duration)
      })
    )
  }
}

agent.use(new MetricsMiddleware(metricsService))
```

## Built-in Middleware

### FilterToolCallsMiddleware

Filter tool calls based on allowed or disallowed lists:

```typescript
import { FilterToolCallsMiddleware } from "@ag-ui/client"

// Only allow specific tools
const allowedFilter = new FilterToolCallsMiddleware({
  allowedToolCalls: ["search", "calculate"]
})

// Or block specific tools
const blockedFilter = new FilterToolCallsMiddleware({
  disallowedToolCalls: ["delete", "modify"]
})

agent.use(allowedFilter)
```

## Common Middleware Patterns

### Logging Middleware

```typescript
import { catchError, tap } from "rxjs/operators"

const loggingMiddleware: MiddlewareFunction = (input, next) => {
  console.log("Request:", input.messages)

  return next.run(input).pipe(
    tap(event => console.log("Event:", event.type)),
    catchError(error => {
      console.error("Error:", error)
      throw error
    })
  )
}
```

### Authentication Middleware

```typescript
class AuthMiddleware extends Middleware {
  constructor(private apiKey: string) {
    super()
  }

  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    const authenticatedInput = {
      ...input,
      context: [
        ...input.context,
        { type: "auth", apiKey: this.apiKey }
      ]
    }

    return next.run(authenticatedInput)
  }
}
```

### Rate Limiting Middleware

```typescript
import { timer } from "rxjs"
import { switchMap } from "rxjs/operators"

class RateLimitMiddleware extends Middleware {
  private lastCall = 0

  constructor(private minInterval: number) {
    super()
  }

  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    const now = Date.now()
    const timeSinceLastCall = now - this.lastCall

    if (timeSinceLastCall < this.minInterval) {
      const delay = this.minInterval - timeSinceLastCall
      return timer(delay).pipe(
        switchMap(() => {
          this.lastCall = Date.now()
          return next.run(input)
        })
      )
    }

    this.lastCall = now
    return next.run(input)
  }
}
```

## Combining Middleware

```typescript
const logMiddleware: MiddlewareFunction = (input, next) => {
  console.log(`Starting run ${input.runId}`)
  return next.run(input)
}

const authMiddleware = new AuthMiddleware(apiKey)

const filterMiddleware = new FilterToolCallsMiddleware({
  allowedToolCalls: ["search", "summarize"]
})

// Apply in order
agent.use(
  logMiddleware,      // First: log the request
  authMiddleware,     // Second: add authentication
  filterMiddleware    // Third: filter tool calls
)
```

## Execution Order

Middleware executes in the order added:

```typescript
agent.use(middleware1, middleware2, middleware3)

// Execution flow:
// → middleware1
//   → middleware2
//     → middleware3
//       → agent.run()
//     ← events through middleware3
//   ← events through middleware2
// ← events through middleware1
```

## Advanced Patterns

### Conditional Middleware

```typescript
const conditionalMiddleware: MiddlewareFunction = (input, next) => {
  if (input.context.some(c => c.type === "debug")) {
    return next.run(input).pipe(
      tap(event => console.debug(event))
    )
  }
  return next.run(input)
}
```

### Event Transformation

```typescript
const transformMiddleware: MiddlewareFunction = (input, next) => {
  return next.run(input).pipe(
    map(event => {
      if (event.type === EventType.TOOL_CALL_START) {
        return {
          ...event,
          metadata: {
            ...event.metadata,
            timestamp: Date.now()
          }
        }
      }
      return event
    })
  )
}
```

### Stream Control

```typescript
import { throttleTime } from "rxjs/operators"

const throttleMiddleware: MiddlewareFunction = (input, next) => {
  return next.run(input).pipe(
    throttleTime(50, undefined, { leading: true, trailing: true })
  )
}
```

## Best Practices

1. **Keep middleware focused** - Single responsibility per middleware
2. **Handle errors gracefully** - Use RxJS error handling operators
3. **Avoid blocking operations** - Use async patterns for I/O
4. **Document side effects** - Indicate if middleware modifies state
5. **Test independently** - Write unit tests for each middleware
6. **Consider performance** - Be mindful of processing overhead

## Source

https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/concepts/middleware.mdx
