# Render Loop Prevention Plan

This document outlines the plan to make `use-ai` more resilient against render loops caused by unstable tool references.

## Executive Summary

**Problem**: When users define tools inline without proper memoization, every component render creates new tool object references. This triggers unnecessary effect re-runs, tool re-registrations, and can cause infinite render loops in complex scenarios.

**Target State**: The library automatically stabilizes tool references internally, making it difficult for users to accidentally cause render loops—even with inline tool definitions.

**Key Insight**: The current architecture relies on users properly memoizing their tools. The PR fix (using refs to stabilize closures) should be a pattern the library handles internally, not something every consumer must implement.

---

## Table of Contents

1. [Problem Analysis](#1-problem-analysis)
2. [Solution Approaches](#2-solution-approaches)
3. [Recommended Approach](#3-recommended-approach)
4. [Implementation Plan](#4-implementation-plan)
5. [Testing Strategy](#5-testing-strategy)
6. [Migration & Breaking Changes](#6-migration--breaking-changes)
7. [Risk Assessment](#7-risk-assessment)

---

## 1. Problem Analysis

### 1.1 Current Data Flow

```
Component renders
       │
       ▼
options.tools object created (potentially new reference)
       │
       ▼
useMemo(() => options.tools, [options.tools])
       │
       ├─── Same reference? → No effect re-run (✓)
       │
       └─── New reference? → Effect re-runs
                    │
                    ▼
           registerTools(hookId, tools)
                    │
                    ▼
    useToolRegistry compares tool NAMES (not references)
                    │
                    ├─── Names changed? → Increment version (re-aggregate)
                    │
                    └─── Names same? → Update ref only (no version change)
                                │
                                ▼
                    aggregatedTools memo re-evaluates
                                │
                                ▼
                    Provider effect may re-run
```

### 1.2 Why Current Guards Are Insufficient

The library has several guards against infinite loops:

| Guard | What It Prevents | What It Doesn't Prevent |
|-------|------------------|-------------------------|
| Tool name string comparison | Version counter thrashing | Effect re-runs |
| `lastRegisteredToolsRef` | Server re-registration | Provider effect re-runs |
| 100ms prompt wait timeout | Infinite tool → prompt loops | Rapid effect cycling |

**The core issue**: Even when tool *names* are identical, new object references cause:
1. `memoizedTools` dependency to change
2. Tool registration effect to re-run
3. `registerTools` to be called (updating the ref)
4. Potential downstream effects to re-run

### 1.3 The Problematic Pattern

```typescript
// ❌ BAD: Creates new tools object every render
function MyComponent() {
  const [state, setState] = useState(initialState);

  return useAI({
    tools: {
      updateState: defineTool('Update state', z.object({ value: z.string() }),
        (input) => {
          setState(input.value);  // Closure over setState
          return { success: true };
        }
      ),
    },
    prompt: JSON.stringify(state),
  });
}
```

Every time `state` changes:
1. Component re-renders
2. New `tools` object created
3. New `updateState` tool created (new function reference)
4. `useMemo` sees new `options.tools` reference
5. Tool registration effect runs
6. Tool executes, calls `setState`
7. State changes → Go to step 1

### 1.4 The PR Fix Pattern (User-Side)

```typescript
// ✓ GOOD: Uses refs to stabilize closures
function MyComponent() {
  const [state, setState] = useState(initialState);

  // Store setState in ref to avoid closure recreation
  const setStateRef = useRef(setState);
  setStateRef.current = setState;

  // Tools created once with empty dependency array
  const tools = useMemo(() => ({
    updateState: defineTool('Update state', z.object({ value: z.string() }),
      (input) => {
        setStateRef.current(input.value);  // Always uses current setState
        return { success: true };
      }
    ),
  }), []);  // Empty deps = stable reference

  return useAI({ tools, prompt: JSON.stringify(state) });
}
```

**This works but is burdensome**: Every consumer must understand and apply this pattern.

---

## 2. Solution Approaches

### Approach A: Deep Tool Comparison

**Concept**: Compare tools by their structural content (description, schema), not object references.

**Implementation**:
```typescript
// In useAI.ts
const memoizedTools = useMemo(() => {
  return options.tools;
}, [stableToolsKey(options.tools)]);

function stableToolsKey(tools?: ToolsDefinition): string {
  if (!tools) return '';
  return Object.entries(tools)
    .map(([name, tool]) => `${name}:${tool.description}:${JSON.stringify(tool.parameters)}`)
    .sort()
    .join('|');
}
```

**Pros**:
- No API changes
- Transparent to users
- Catches description/schema changes

**Cons**:
- JSON.stringify on every render (performance)
- Doesn't solve the closure staleness problem
- Complex schemas may serialize slowly

### Approach B: Automatic Ref Wrapping

**Concept**: Automatically wrap tool handlers in refs to maintain stable references while allowing closures to update.

**Implementation**:
```typescript
// In useAI.ts or a new hook
function useStableTools(tools?: ToolsDefinition): ToolsDefinition | undefined {
  const toolsRef = useRef<ToolsDefinition>({});
  const stableTools = useRef<ToolsDefinition>({});

  // Always update the ref with latest tools
  toolsRef.current = tools ?? {};

  // Create stable wrappers on first render or when tool names change
  const toolNames = tools ? Object.keys(tools).sort().join(',') : '';
  const prevToolNames = useRef('');

  if (toolNames !== prevToolNames.current) {
    prevToolNames.current = toolNames;
    stableTools.current = {};

    if (tools) {
      for (const [name, tool] of Object.entries(tools)) {
        stableTools.current[name] = {
          description: tool.description,
          parameters: tool.parameters,
          confirmationRequired: tool.confirmationRequired,
          handler: (...args) => toolsRef.current[name]?.handler(...args),
        };
      }
    }
  } else if (tools) {
    // Update descriptions/schemas in place (no new objects)
    for (const [name, tool] of Object.entries(tools)) {
      if (stableTools.current[name]) {
        stableTools.current[name].description = tool.description;
        stableTools.current[name].parameters = tool.parameters;
        stableTools.current[name].confirmationRequired = tool.confirmationRequired;
      }
    }
  }

  return tools ? stableTools.current : undefined;
}
```

**Pros**:
- Completely transparent to users
- Handlers always use latest closures
- Stable object references prevent effect thrashing
- No serialization cost

**Cons**:
- Slight complexity in implementation
- Need to handle edge cases (tool addition/removal)

### Approach C: Registration Debouncing

**Concept**: Debounce tool registration to coalesce rapid changes.

**Implementation**:
```typescript
// In useToolRegistry.ts
const registerTools = useCallback((id, tools, options) => {
  pendingRegistrations.current.set(id, { tools, options });

  if (debounceTimerRef.current) {
    clearTimeout(debounceTimerRef.current);
  }

  debounceTimerRef.current = setTimeout(() => {
    // Process all pending registrations
    pendingRegistrations.current.forEach((reg, regId) => {
      actuallyRegisterTools(regId, reg.tools, reg.options);
    });
    pendingRegistrations.current.clear();
  }, 0);  // Next tick
}, []);
```

**Pros**:
- Simple concept
- Handles rapid mount/unmount
- No API changes

**Cons**:
- Doesn't solve the root cause
- Adds latency to tool availability
- Complex timing edge cases

---

## 3. Recommended Approach

We recommend **Approach B (Automatic Ref Wrapping)** as the primary solution.

**Why not the others?**
- **Approach A (Deep Comparison)**: Requires JSON.stringify on schemas every render - expensive and doesn't solve closure staleness
- **Approach C (Debouncing)**: Adds latency and doesn't address root cause
- **Hybrid**: Unnecessary complexity. Approach B alone is sufficient because:
  - `useStableTools` returns stable object references (no effect thrashing)
  - Tool name changes are detected with cheap `Object.keys().sort().join(',')` (no schema serialization)
  - Fresh closures are maintained via ref proxying

**Implementation components:**

### 3.1 Core: `useStableTools` Hook

A new internal hook that:
1. Creates stable tool object references
2. Wraps handlers to call through refs
3. Updates refs on every render (always fresh closures)
4. Only creates new tool objects when tool names change

### 3.2 Structural Comparison for Effect Dependencies

Change the `memoizedTools` in `useAI.ts` to use a structural key:

```typescript
const toolsKey = useMemo(() => {
  if (!options.tools) return '';
  return Object.keys(options.tools).sort().join(',');
}, [options.tools]);

const stableTools = useStableTools(options.tools);

// Effect now depends on toolsKey, not the object reference
useEffect(() => {
  if (!enabled || !stableTools) return;
  // ... registration logic
}, [enabled, toolsKey, stableTools, ...]);
```

---

## 4. Implementation Plan

### Phase 1: Create `useStableTools` Hook

**File**: `packages/client/src/hooks/useStableTools.ts`

```typescript
import { useRef } from 'react';
import type { ToolsDefinition, ToolDefinition } from '../defineTool';

/**
 * Creates stable tool references that maintain fresh closures.
 *
 * Tool object references remain stable as long as tool names don't change.
 * Handler calls are proxied through refs to always use the latest closure.
 */
export function useStableTools(tools?: ToolsDefinition): ToolsDefinition | undefined {
  // Ref to store latest tools (updated every render)
  const latestToolsRef = useRef<ToolsDefinition>({});

  // Ref to store stable wrapper objects
  const stableToolsRef = useRef<ToolsDefinition>({});

  // Track tool names for change detection
  const prevToolNamesRef = useRef<string>('');

  if (!tools) {
    latestToolsRef.current = {};
    return undefined;
  }

  // Always update latest ref (for fresh closures)
  latestToolsRef.current = tools;

  const currentToolNames = Object.keys(tools).sort().join(',');

  if (currentToolNames !== prevToolNamesRef.current) {
    // Tool names changed - rebuild stable wrappers
    prevToolNamesRef.current = currentToolNames;
    stableToolsRef.current = {};

    for (const [name, tool] of Object.entries(tools)) {
      stableToolsRef.current[name] = createStableToolWrapper(
        name,
        tool,
        latestToolsRef
      );
    }
  } else {
    // Tool names unchanged - update metadata only
    for (const [name, tool] of Object.entries(tools)) {
      const stable = stableToolsRef.current[name];
      if (stable) {
        stable.description = tool.description;
        stable.parameters = tool.parameters;
        stable.confirmationRequired = tool.confirmationRequired;
      }
    }
  }

  return stableToolsRef.current;
}

function createStableToolWrapper(
  name: string,
  tool: ToolDefinition,
  latestToolsRef: React.MutableRefObject<ToolsDefinition>
): ToolDefinition {
  return {
    description: tool.description,
    parameters: tool.parameters,
    confirmationRequired: tool.confirmationRequired,
    handler: (...args: unknown[]) => {
      const currentTool = latestToolsRef.current[name];
      if (!currentTool) {
        throw new Error(`Tool "${name}" no longer exists`);
      }
      return currentTool.handler(...args);
    },
  };
}
```

### Phase 2: Integrate into `useAI`

**File**: `packages/client/src/useAI.ts`

```diff
 import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
 import { useAIContext } from './providers/useAIProvider';
 import { type ToolsDefinition } from './defineTool';
+import { useStableTools } from './hooks/useStableTools';
 import type { AGUIEvent, RunErrorEvent } from './types';
 import { EventType } from './types';

 export function useAI(options: UseAIOptions = {}): UseAIResult {
   // ... existing code ...

-  const memoizedTools = useMemo(() => options.tools, [options.tools]);
+  // Stabilize tools to prevent render loops from unstable references
+  const stableTools = useStableTools(options.tools);
+
+  // Derive a key for effect dependencies (based on tool names only)
+  const toolsKey = useMemo(() => {
+    if (!options.tools) return '';
+    return Object.keys(options.tools).sort().join(',');
+  }, [options.tools]);

   // Register tools
   useEffect(() => {
     if (!enabled) return;
-    if (memoizedTools) {
+    if (stableTools) {
       const componentId = options.id || componentRef.current?.id;
       const toolsToRegister = componentId
-        ? namespaceTools(memoizedTools, componentId)
-        : memoizedTools;
+        ? namespaceTools(stableTools, componentId)
+        : stableTools;

       registerTools(hookId.current, toolsToRegister, { invisible: options.invisible });
       toolsRef.current = toolsToRegister;
     }

     return () => {
-      if (memoizedTools) {
+      if (stableTools) {
         unregisterTools(hookId.current);
       }
     };
-  }, [enabled, memoizedTools, options.id, options.invisible, registerTools, unregisterTools]);
+  }, [enabled, toolsKey, stableTools, options.id, options.invisible, registerTools, unregisterTools]);
```

### Phase 3: Export and Documentation

**File**: `packages/client/src/index.ts`

```diff
 export { useAI } from './useAI';
 export type { UseAIOptions, UseAIResult } from './useAI';
+export { useStableTools } from './hooks/useStableTools';
```

Add JSDoc to exported hook explaining its purpose and when users might want to use it directly.

---

## 5. Testing Strategy

### 5.1 Unit Tests

**File**: `packages/client/src/hooks/useStableTools.test.ts`

```typescript
describe('useStableTools', () => {
  it('returns undefined for undefined input', () => {
    const { result } = renderHook(() => useStableTools(undefined));
    expect(result.current).toBeUndefined();
  });

  it('returns stable reference when tool names unchanged', () => {
    const tools1 = { foo: createMockTool() };
    const tools2 = { foo: createMockTool() }; // Same names, different object

    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: tools1 } }
    );

    const firstResult = result.current;
    rerender({ tools: tools2 });

    expect(result.current).toBe(firstResult); // Same reference
  });

  it('returns new reference when tool names change', () => {
    const tools1 = { foo: createMockTool() };
    const tools2 = { foo: createMockTool(), bar: createMockTool() };

    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: tools1 } }
    );

    const firstResult = result.current;
    rerender({ tools: tools2 });

    expect(result.current).not.toBe(firstResult); // New reference
    expect(Object.keys(result.current!)).toEqual(['bar', 'foo']);
  });

  it('calls latest handler through stable wrapper', () => {
    const handler1 = jest.fn(() => 'result1');
    const handler2 = jest.fn(() => 'result2');

    const tools1 = { foo: { ...createMockTool(), handler: handler1 } };
    const tools2 = { foo: { ...createMockTool(), handler: handler2 } };

    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: tools1 } }
    );

    // Call through stable wrapper
    result.current!.foo.handler({});
    expect(handler1).toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();

    // Update to new handler
    rerender({ tools: tools2 });

    // Same stable wrapper now calls new handler
    result.current!.foo.handler({});
    expect(handler2).toHaveBeenCalled();
  });

  it('updates description without changing reference', () => {
    const tools1 = { foo: createMockTool('Description 1') };
    const tools2 = { foo: createMockTool('Description 2') };

    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: tools1 } }
    );

    const firstResult = result.current;
    expect(firstResult!.foo.description).toBe('Description 1');

    rerender({ tools: tools2 });

    expect(result.current).toBe(firstResult); // Same reference
    expect(result.current!.foo.description).toBe('Description 2'); // Updated
  });
});
```

### 5.2 Integration Tests

**File**: `packages/client/src/hooks/useStableTools.integration.test.tsx`

```typescript
describe('useStableTools integration', () => {
  it('prevents render loop with inline tool definitions', async () => {
    let renderCount = 0;

    function TestComponent() {
      renderCount++;
      const [count, setCount] = useState(0);

      // Intentionally unstable: new object every render
      useAI({
        tools: {
          increment: defineTool('Increment', z.object({}), () => {
            setCount(c => c + 1);
            return { success: true };
          }),
        },
        prompt: `Count: ${count}`,
      });

      return <div>{count}</div>;
    }

    render(<TestComponent />);

    // Wait for potential loop
    await act(() => new Promise(r => setTimeout(r, 200)));

    // Should not have rendered excessively
    expect(renderCount).toBeLessThan(5);
  });

  it('maintains fresh closures through stable references', async () => {
    const values: number[] = [];

    function TestComponent() {
      const [count, setCount] = useState(0);

      useAI({
        tools: {
          capture: defineTool('Capture', z.object({}), () => {
            values.push(count); // Closure over count
            return { success: true };
          }),
        },
        prompt: `Count: ${count}`,
      });

      return (
        <button onClick={() => setCount(c => c + 1)}>
          Count: {count}
        </button>
      );
    }

    const { getByRole } = render(<TestComponent />);

    // Simulate tool calls at different count values
    // (would need mock client infrastructure)
    // ...

    // Verify closures captured correct values
    expect(values).toEqual([0, 1, 2]); // Not all 0s
  });
});
```

### 5.3 E2E Tests

**File**: `apps/example/test/render-loop-prevention.e2e.test.ts`

```typescript
test('handles rapid state changes without infinite loop', async ({ page }) => {
  // Setup component that updates state on every tool call
  await page.goto('/test-rapid-state');

  // Send message that triggers tool
  await page.fill('[data-testid="chat-input"]', 'Run the counter tool 5 times');
  await page.click('[data-testid="send-button"]');

  // Should complete without timeout
  await expect(page.getByText('Count: 5')).toBeVisible({ timeout: 10000 });
});

test('inline tool definitions do not cause render loops', async ({ page }) => {
  // Setup component with inline tools (previously problematic)
  await page.goto('/test-inline-tools');

  // Track render count via exposed window variable
  const initialRenders = await page.evaluate(() => (window as any).__renderCount);

  // Wait and verify renders stabilize
  await page.waitForTimeout(500);

  const finalRenders = await page.evaluate(() => (window as any).__renderCount);

  // Should not have excessive renders (allows for initial mount + 1 effect cycle)
  expect(finalRenders - initialRenders).toBeLessThan(5);
});
```

### 5.4 Performance Tests

```typescript
describe('useStableTools performance', () => {
  it('handles large tool sets efficiently', () => {
    const largeTooSet = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [
        `tool${i}`,
        createMockTool(`Tool ${i}`),
      ])
    );

    const start = performance.now();

    const { rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: largeTooSet } }
    );

    // Simulate 100 re-renders
    for (let i = 0; i < 100; i++) {
      rerender({ tools: { ...largeTooSet } });
    }

    const duration = performance.now() - start;

    // Should be fast (< 100ms for 100 rerenders with 100 tools)
    expect(duration).toBeLessThan(100);
  });
});
```

---

## 6. Migration & Breaking Changes

### 6.1 Behavioral Changes

| Behavior | Before | After |
|----------|--------|-------|
| Tool object stability | User's responsibility | Automatic |
| Inline tools | Causes re-registrations | Works correctly |
| Description changes | New registration | In-place update |
| Handler updates | Requires memoization | Automatic via refs |

### 6.2 Breaking Changes

**None expected.** The changes are internal implementation details that maintain the same external API.

### 6.3 Deprecations

Consider deprecating direct manipulation patterns:

```typescript
// Before (still works, but unnecessary)
const tools = useMemo(() => ({
  myTool: defineTool(...)
}), []);

// After (just works)
const tools = {
  myTool: defineTool(...)
};
```

### 6.4 Migration Guide

**For existing code**: No changes required. Existing memoization patterns continue to work.

**For new code**: Users no longer need to memoize tools. Can define inline:

```typescript
// Now safe to do this:
useAI({
  tools: {
    myTool: defineTool('Do something', z.object({}), () => {
      // Uses current closure values
      return doSomethingWith(currentState);
    }),
  },
});
```

---

## 7. Risk Assessment

### 7.1 Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Ref staleness edge cases | Low | Medium | Thorough testing of async handlers |
| Performance regression | Low | Low | Benchmark tests, lazy wrapper creation |
| Unexpected handler behavior | Low | High | Clear documentation, gradual rollout |
| Tool removal during execution | Low | Medium | Graceful error handling in wrapper |

### 7.2 Rollback Plan

The implementation can be feature-flagged:

```typescript
export interface UseAIOptions {
  // ...existing options

  /**
   * @internal
   * @deprecated Will be removed in v2.0
   * Disable automatic tool stabilization (legacy behavior)
   */
  _disableToolStabilization?: boolean;
}
```

### 7.3 Monitoring (Optional)

Consider adding debug logging (behind a flag) for:
- Tool registration events
- Stable wrapper creation vs reuse
- Tool name change detection

---

## Appendix A: Alternative Considered - React Compiler

React Compiler (React 19) may automatically memoize component values. However:

1. Not everyone will be on React 19
2. Compiler may not catch all cases
3. Library-level protection is more reliable

We should still implement this fix for broad compatibility.

## Appendix B: Related Issues

- Original PR fixing customer render loop
- Simon Willison's "Lethal Trifecta" security considerations (render loops could be attack vector)
- React docs on referential equality

## Appendix C: Implementation Checklist

- [x] Create `useStableTools` hook
- [x] Add unit tests for `useStableTools`
- [x] Integrate into `useAI`
- [x] Add integration tests
- [ ] Add E2E tests (existing E2E tests cover the use case; internal fix requires no new pages)
- [ ] Update documentation
- [ ] Add performance benchmarks
- [ ] Review and update CLAUDE.md patterns
- [ ] Release with changelog entry
