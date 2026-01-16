# Agent Plugin System Implementation Plan

## Overview

This document outlines the implementation of a generic plugin system for `AISDKAgent` that enables extensible, composable functionality. Citations will be implemented as the first plugin to validate the architecture.

## Goals

1. **Extensibility** - Allow users to add custom functionality without modifying core agent code
2. **Composability** - Plugins can be combined in a defined order
3. **Provider-agnostic** - Plugins work across different AI providers (OpenAI, Anthropic, etc.)
4. **Backwards compatible** - Existing code continues to work without changes
5. **Testable** - Each plugin can be unit tested in isolation

## Architecture

### Plugin Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Run Lifecycle                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────┐                                              │
│  │ onUserMessage  │ ← Modify messages, system prompt, tools      │
│  └───────┬────────┘                                              │
│          │                                                       │
│          ▼                                                       │
│  ┌────────────────┐                                              │
│  │  AI SDK Call   │ ← generateText() or streamText()             │
│  └───────┬────────┘                                              │
│          │                                                       │
│          ▼ (streaming only)                                      │
│  ┌────────────────┐                                              │
│  │  onTextChunk   │ ← Transform streaming chunks                 │
│  └───────┬────────┘                                              │
│          │                                                       │
│          ▼ (if tool calls)                                       │
│  ┌──────────────────┐     ┌───────────────────┐                  │
│  │ onBeforeToolCall │ ──► │ onAfterToolCall   │ ← Modify tool IO │
│  └──────────────────┘     └─────────┬─────────┘                  │
│                                     │                            │
│          ┌──────────────────────────┘                            │
│          ▼                                                       │
│  ┌──────────────────┐                                            │
│  │ onAgentResponse  │ ← Process results, emit events, transform  │
│  └──────────────────┘                                            │
│                                                                  │
│  ┌────────────────┐                                              │
│  │    onError     │ ← Handle errors (called if any step fails)   │
│  └────────────────┘                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Plugin Execution Order

Plugins are executed in the order they appear in the `plugins` array. The user controls ordering by arranging plugins in the desired sequence:

```typescript
new AISDKAgent({
  model: openai('gpt-4o'),
  plugins: [
    rateLimitPlugin,      // Runs first (security)
    citationPlugin,       // Runs second (feature)
    loggingPlugin,        // Runs last (observer)
  ],
});
```

### Shared State

Plugins can share data within a single run via `context.state`:

```typescript
// Plugin A (registered first)
beforeRun(input, context) {
  context.state.set('startTime', Date.now());
  return input;
}

// Plugin B (registered later)
afterRun(result, context) {
  const duration = Date.now() - context.state.get('startTime');
  console.log(`Run took ${duration}ms`);
  return result;
}
```

## Implementation Phases

### Phase 1: Core Plugin Infrastructure

**Files to create:**

```
packages/server/src/agents/plugins/
├── types.ts           # Plugin interfaces and types
├── runner.ts          # Plugin orchestration
├── index.ts           # Public exports
└── __tests__/
    └── runner.test.ts # Unit tests
```

**types.ts:**

```typescript
import type { CoreMessage } from 'ai';

export interface AgentPluginContext {
  runId: string;
  clientId: string;
  threadId?: string;
  provider: string;
  events: EventEmitter;
  state: Map<string, unknown>;
  logger: Logger;
}

export interface AgentRunInput {
  messages: CoreMessage[];
  systemPrompt?: string;
  tools: Record<string, unknown>;
  providerTools?: Record<string, unknown>;
}

export interface AgentRunResult {
  text: string;
  sources?: unknown[];
  response?: { messages: unknown[] };
  providerMetadata?: Record<string, unknown>;
  toolCalls?: unknown[];
  toolResults?: unknown[];
  usage?: { promptTokens: number; completionTokens: number };
}

export interface ToolCallInfo {
  id: string;
  name: string;
  args: unknown;
}

export interface ToolResultInfo extends ToolCallInfo {
  result: unknown;
  error?: Error;
}

export interface AgentPlugin {
  /** Unique plugin identifier */
  id: string;

  /** Initialize plugin (called once when agent is created) */
  initialize?(context: { provider: string }): void | Promise<void>;

  /**
   * Called before the user message is sent to AI SDK.
   * Can modify messages, system prompt, or tools.
   */
  onUserMessage?(
    input: AgentRunInput,
    context: AgentPluginContext
  ): AgentRunInput | Promise<AgentRunInput>;

  /**
   * Called after AI SDK completes processing (including all tool calls).
   * Can process results, emit events, or transform the final text.
   */
  onAgentResponse?(
    result: AgentRunResult,
    context: AgentPluginContext
  ): AgentRunResult | Promise<AgentRunResult>;

  /**
   * Called for each streaming text chunk.
   * Can transform chunks. Async to allow plugin authors to add latency if needed.
   */
  onTextChunk?(
    chunk: string,
    context: AgentPluginContext
  ): string | void | Promise<string | void>;

  /** Called before a tool is executed */
  onBeforeToolCall?(
    toolCall: ToolCallInfo,
    context: AgentPluginContext
  ): ToolCallInfo | null | Promise<ToolCallInfo | null>;

  /** Called after a tool is executed */
  onAfterToolCall?(
    toolResult: ToolResultInfo,
    context: AgentPluginContext
  ): unknown | Promise<unknown>;

  /** Called on error */
  onError?(error: Error, context: AgentPluginContext): void;

  /** Cleanup (called when agent is destroyed) */
  destroy?(): void | Promise<void>;
}
```

**runner.ts:**

```typescript
export class AgentPluginRunner {
  private plugins: AgentPlugin[] = [];

  constructor(plugins: AgentPlugin[] = []) {
    this.plugins = plugins;
  }

  async initialize(context: { provider: string }): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.initialize?.(context);
    }
  }

  async onUserMessage(
    input: AgentRunInput,
    context: AgentPluginContext
  ): Promise<AgentRunInput> {
    let result = input;
    for (const plugin of this.plugins) {
      if (plugin.onUserMessage) {
        result = await plugin.onUserMessage(result, context);
      }
    }
    return result;
  }

  async onAgentResponse(
    result: AgentRunResult,
    context: AgentPluginContext
  ): Promise<AgentRunResult> {
    let processed = result;
    for (const plugin of this.plugins) {
      if (plugin.onAgentResponse) {
        processed = await plugin.onAgentResponse(processed, context);
      }
    }
    return processed;
  }

  async onTextChunk(chunk: string, context: AgentPluginContext): Promise<string> {
    let result = chunk;
    for (const plugin of this.plugins) {
      if (plugin.onTextChunk) {
        const transformed = await plugin.onTextChunk(result, context);
        if (transformed !== undefined) result = transformed;
      }
    }
    return result;
  }

  async onBeforeToolCall(
    toolCall: ToolCallInfo,
    context: AgentPluginContext
  ): Promise<ToolCallInfo | null> {
    let current: ToolCallInfo | null = toolCall;
    for (const plugin of this.plugins) {
      if (current === null) break;
      if (plugin.onBeforeToolCall) {
        current = await plugin.onBeforeToolCall(current, context);
      }
    }
    return current;
  }

  async onAfterToolCall(
    toolResult: ToolResultInfo,
    context: AgentPluginContext
  ): Promise<unknown> {
    let result = toolResult.result;
    for (const plugin of this.plugins) {
      if (plugin.onAfterToolCall) {
        result = await plugin.onAfterToolCall({ ...toolResult, result }, context);
      }
    }
    return result;
  }

  onError(error: Error, context: AgentPluginContext): void {
    for (const plugin of this.plugins) {
      try {
        plugin.onError?.(error, context);
      } catch (e) {
        // Don't let error handlers break the chain
        context.logger.error('Plugin error handler failed', {
          pluginId: plugin.id,
          error: e,
        });
      }
    }
  }

  async destroy(): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.destroy?.();
    }
  }
}
```

### Phase 2: AISDKAgent Integration

**Files to modify:**

- `packages/server/src/agents/AISDKAgent.ts`
- `packages/server/src/agents/types.ts`

**Changes to AISDKAgentConfig:**

```typescript
export interface AISDKAgentConfig {
  model: LanguageModel;
  name?: string;
  systemPrompt?: string;
  providerTools?: Record<string, unknown>;
  maxSteps?: number;
  langfuse?: LangfuseConfig;
  // New: plugin support
  plugins?: AgentPlugin[];
}
```

**Changes to AISDKAgent constructor:**

```typescript
class AISDKAgent implements Agent {
  private pluginRunner: AgentPluginRunner;

  constructor(config: AISDKAgentConfig) {
    // ... existing code ...

    // Create plugin runner with provided plugins
    this.pluginRunner = new AgentPluginRunner(config.plugins ?? []);

    // Initialize plugins
    this.pluginRunner.initialize({ provider: this.getProviderName() });
  }
}
```

**Changes to AISDKAgent.run():**

```typescript
async run(/* ... */) {
  const context: AgentPluginContext = {
    runId,
    clientId: session.clientId,
    threadId: session.threadId,
    provider: this.getProviderName(),
    events,
    state: new Map(),
    logger,
  };

  try {
    // onUserMessage hook - before sending to AI SDK
    const processedInput = await this.pluginRunner.onUserMessage(
      {
        messages,
        systemPrompt: this.systemPrompt,
        tools: clientTools,
        providerTools: this.providerTools,
      },
      context
    );

    // Use processedInput.messages, processedInput.systemPrompt, etc.
    const result = await generateText({
      model: this.model,
      messages: this.buildMessages(processedInput),
      tools: processedInput.tools,
      // ...
    });

    // onAgentResponse hook - after AI SDK completes
    const processedResult = await this.pluginRunner.onAgentResponse(
      {
        text: result.text,
        sources: result.sources,
        response: result.response,
        providerMetadata: result.providerMetadata,
        usage: result.usage,
      },
      context
    );

    // Use processedResult.text for the response
    finalText = processedResult.text;

    // ... emit events ...

  } catch (error) {
    this.pluginRunner.onError(error as Error, context);
    throw error;
  }
}
```

### Phase 3: Citation Plugin Implementation (Separate PR)

This phase will be implemented in a separate PR after the plugin system is complete and tested.

**Files to create:**

```
packages/server/src/agents/plugins/citations/
├── types.ts           # Citation-specific types
├── plugin.ts          # Citation plugin factory
├── extractors/
│   ├── openai.ts      # OpenAI citation extractor
│   ├── anthropic.ts   # Anthropic citation extractor
│   └── index.ts       # Extractor exports
├── index.ts           # Public exports
└── __tests__/
    ├── plugin.test.ts
    └── extractors.test.ts
```

**types.ts:**

```typescript
import type { Citation } from '../../../types';
import type { AgentRunResult } from '../types';

export interface CitationExtractor {
  /** Provider(s) this extractor handles */
  providers: string[];

  /** Extract citations from the AI SDK result */
  extract(result: AgentRunResult): Citation[];

  /** Optional: Transform text to insert inline citation markers */
  transformText?(text: string, citations: Citation[]): string;
}

export interface CitationPluginOptions {
  /** Citation extractors for different providers */
  extractors: CitationExtractor[];

  /** Insert inline markers like [1], [2] at citation positions. Default: true */
  inlineMarkers?: boolean;

  /** Custom event name. Default: 'citation' */
  eventName?: string;
}
```

**extractors/openai.ts:**

```typescript
import type { CitationExtractor } from '../types';
import type { Citation } from '../../../../types';
import { v4 as uuidv4 } from 'uuid';

interface OpenAIAnnotation {
  type: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

export const openaiCitationExtractor: CitationExtractor = {
  providers: ['openai', 'azure-openai'],

  extract(result): Citation[] {
    const citations: Citation[] = [];
    let number = 0;

    // Extract from response messages' providerMetadata
    const messages = result.response?.messages ?? [];
    for (const msg of messages) {
      if ((msg as any).role !== 'assistant') continue;

      const content = (msg as any).content ?? [];
      for (const part of content) {
        if (part.type !== 'text') continue;

        const annotations: OpenAIAnnotation[] =
          part.providerMetadata?.openai?.annotations ?? [];

        for (const ann of annotations) {
          if (ann.type === 'url_citation' && ann.url) {
            number++;
            citations.push({
              id: uuidv4(),
              number,
              type: 'url',
              url: ann.url,
              title: ann.title,
              startIndex: ann.start_index,
              endIndex: ann.end_index,
            });
          }
        }
      }
    }

    // Fallback: extract from sources if no annotations found
    if (citations.length === 0 && result.sources) {
      for (const source of result.sources) {
        const src = source as any;
        if (src.sourceType === 'url' && src.url) {
          number++;
          citations.push({
            id: src.id ?? uuidv4(),
            number,
            type: 'url',
            url: src.url,
            title: src.title,
          });
        }
      }
    }

    return citations;
  },

  transformText(text, citations): string {
    // Filter citations with position data and sort by end position descending
    const positioned = citations
      .filter(c => c.endIndex !== undefined)
      .sort((a, b) => (b.endIndex ?? 0) - (a.endIndex ?? 0));

    if (positioned.length === 0) return text;

    // Insert markers from end to start to preserve positions
    let result = text;
    for (const citation of positioned) {
      if (citation.endIndex !== undefined && citation.endIndex <= result.length) {
        result =
          result.slice(0, citation.endIndex) +
          `[${citation.number}]` +
          result.slice(citation.endIndex);
      }
    }

    return result;
  },
};
```

**extractors/anthropic.ts:**

```typescript
import type { CitationExtractor } from '../types';
import type { Citation } from '../../../../types';
import { v4 as uuidv4 } from 'uuid';

export const anthropicCitationExtractor: CitationExtractor = {
  providers: ['anthropic'],

  extract(result): Citation[] {
    const citations: Citation[] = [];
    let number = 0;

    // Anthropic provides sources but no position data
    // See: https://github.com/vercel/ai/issues/9254
    for (const source of result.sources ?? []) {
      const src = source as any;
      if (src.sourceType === 'url' && src.url) {
        number++;
        citations.push({
          id: src.id ?? uuidv4(),
          number,
          type: 'url',
          url: src.url,
          title: src.title,
          // No position data available from Anthropic
        });
      }
    }

    return citations;
  },

  // No transformText - Anthropic doesn't provide position data
};
```

**plugin.ts:**

```typescript
import type { AgentPlugin, AgentPluginContext, AgentRunResult } from '../types';
import type { CitationPluginOptions, CitationExtractor } from './types';
import type { Citation, CitationEvent, CustomEvent } from '../../../types';
import { EventType, CITATION_EVENT_NAME } from '../../../types';

export function createCitationPlugin(options: CitationPluginOptions): AgentPlugin {
  const { extractors, inlineMarkers = true, eventName = CITATION_EVENT_NAME } = options;

  function getExtractor(provider: string): CitationExtractor | undefined {
    return extractors.find(e => e.providers.includes(provider));
  }

  return {
    id: 'citations',

    onAgentResponse(result: AgentRunResult, context: AgentPluginContext): AgentRunResult {
      const extractor = getExtractor(context.provider);
      if (!extractor) {
        context.logger.debug('No citation extractor for provider', {
          provider: context.provider,
        });
        return result;
      }

      // Extract citations
      const citations = extractor.extract(result);
      if (citations.length === 0) {
        return result;
      }

      context.logger.debug('Citations extracted', {
        count: citations.length,
        provider: context.provider,
      });

      // Store in context for other plugins
      context.state.set('citations', citations);

      // Emit citation event
      const messageId = context.state.get('messageId') as string | undefined;
      context.events.emit<CustomEvent>({
        type: EventType.CUSTOM,
        name: eventName,
        value: {
          messageId: messageId ?? context.runId,
          citations,
        } satisfies CitationEvent,
        timestamp: Date.now(),
      });

      // Transform text with inline markers if supported
      if (inlineMarkers && extractor.transformText) {
        const transformedText = extractor.transformText(result.text, citations);
        return { ...result, text: transformedText };
      }

      return result;
    },
  };
}

// Convenience export with default extractors
export { openaiCitationExtractor } from './extractors/openai';
export { anthropicCitationExtractor } from './extractors/anthropic';
```

### Phase 4: Migration & Backwards Compatibility

**Remove hardcoded citation logic from AISDKAgent:**

The existing citation collection code in `AISDKAgent.run()` will be removed and replaced with the plugin system. To maintain backwards compatibility:

```typescript
// Default plugins if none specified
const defaultPlugins: AgentPlugin[] = [
  createCitationPlugin({
    extractors: [openaiCitationExtractor, anthropicCitationExtractor],
  }),
];

// In constructor
const plugins = config.plugins ?? defaultPlugins;
```

Users who want to disable citations:

```typescript
new AISDKAgent({
  model: openai('gpt-4o'),
  plugins: [], // No plugins, no citations
});
```

### Phase 5: Documentation & Examples

**Files to create:**

- `docs/plugins.md` - Plugin system documentation
- `docs/plugins/citations.md` - Citation plugin documentation
- `docs/plugins/custom.md` - Guide for writing custom plugins

**Example plugins to document:**

1. **Logging plugin** - Log all agent activity
2. **Metrics plugin** - Track token usage, latency
3. **Content filter plugin** - Filter PII from responses
4. **Prompt injection detection** - Detect malicious inputs
5. **Custom RAG citations** - Extract citations from custom RAG systems

## File Summary

### PR 1: New Files

| File                                           | Description             |
|------------------------------------------------|-------------------------|
| `packages/server/src/agents/plugins/types.ts`  | Core plugin interfaces  |
| `packages/server/src/agents/plugins/runner.ts` | Plugin orchestration    |
| `packages/server/src/agents/plugins/index.ts`  | Public exports          |

### PR 1: Modified Files

| File                                        | Changes                   |
|---------------------------------------------|---------------------------|
| `packages/server/src/agents/AISDKAgent.ts`  | Add plugin runner, hooks  |
| `packages/server/src/agents/types.ts`       | Add `plugins` to config   |
| `packages/server/src/index.ts`              | Export plugin types       |

### PR 2: New Files (Citation Plugin)

| File                                                                   | Description        |
|------------------------------------------------------------------------|--------------------|
| `packages/server/src/agents/plugins/citations/types.ts`                | Citation types     |
| `packages/server/src/agents/plugins/citations/plugin.ts`               | Citation plugin    |
| `packages/server/src/agents/plugins/citations/extractors/openai.ts`    | OpenAI extractor   |
| `packages/server/src/agents/plugins/citations/extractors/anthropic.ts` | Anthropic extractor|
| `packages/server/src/agents/plugins/citations/index.ts`                | Citation exports   |

### PR 2: Modified Files

| File                               | Changes                                |
|------------------------------------|----------------------------------------|
| `packages/core/src/citations.ts`   | Add `startIndex`, `endIndex` to Citation |

### PR 2: Files to Remove/Deprecate

| File/Code                                          | Reason              |
|----------------------------------------------------|---------------------|
| Hardcoded citation collection in `AISDKAgent.run()` | Replaced by plugin  |

## Testing Strategy

### Unit Tests

1. **Plugin runner tests** (`runner.test.ts`)
   - Plugin registration and ordering
   - Hook execution order
   - Error handling in hooks
   - Context state sharing

2. **Citation plugin tests** (`citations/plugin.test.ts`)
   - Event emission
   - Text transformation
   - Provider fallback

3. **Extractor tests** (`citations/extractors.test.ts`)
   - OpenAI annotation parsing
   - Anthropic source parsing
   - Edge cases (missing fields, empty results)

### Integration Tests

1. **AISDKAgent with plugins**
   - Multiple plugins interact correctly
   - Plugin errors don't break agent
   - Backwards compatibility

### E2E Tests

1. **Citation flow with real API**
   - OpenAI web search returns citations
   - Citations appear in client UI

## Rollout Plan

### PR 1: Plugin System

1. **Phase 1**: Core infrastructure
   - Plugin types and runner
   - Unit tests

2. **Phase 2**: AISDKAgent integration
   - Add plugin hooks to run loop
   - Integration tests

### PR 2: Citation Plugin (separate)

3. **Phase 3**: Citation plugin
   - Extractors for OpenAI and Anthropic
   - Migrate existing citation code
   - Remove hardcoded citation logic

### PR 3: Documentation (optional)

4. **Phase 4-5**: Docs and examples
   - Plugin system docs
   - Example plugins

## Design Decisions

1. **Streaming support**: `onTextChunk` is async. Plugin authors can introduce latency if needed for their use case.

2. **Plugin dependencies**: Not supported. Users control execution order via array ordering.

3. **Plugin configuration validation**: Relies on TypeScript's type system. No runtime validation.

4. **Hot reloading**: Not supported. Plugins are registered at agent creation time.

## References

- [AI SDK Issue #9254](https://github.com/vercel/ai/issues/9254) - Source vs citation inconsistency
- [AI SDK Issue #8079](https://github.com/vercel/ai/issues/8079) - Missing annotation fields
- [OpenAI Web Search Docs](https://platform.openai.com/docs/guides/tools-web-search) - url_citation format
