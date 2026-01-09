import { describe, test, expect, mock } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { useStableTools } from './useStableTools';
import { defineTool, type ToolsDefinition } from '../defineTool';
import { z } from 'zod';

// Helper to create a mock tool
function createMockTool(description = 'Mock tool', handler = () => ({ success: true })) {
  return defineTool(description, z.object({ value: z.string().optional() }), handler);
}

describe('useStableTools - Unit', () => {
  test('returns undefined for undefined input', () => {
    const { result } = renderHook(() => useStableTools(undefined));
    expect(result.current).toBeUndefined();
  });

  test('returns stable reference when tool names unchanged', () => {
    const handler1 = mock(() => ({ result: 1 }));
    const handler2 = mock(() => ({ result: 2 }));

    const tools1: ToolsDefinition = { foo: createMockTool('Tool v1', handler1) };
    const tools2: ToolsDefinition = { foo: createMockTool('Tool v1', handler2) }; // Same name, different object

    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: tools1 } }
    );

    const firstResult = result.current;
    expect(firstResult).toBeDefined();

    // Rerender with new tools object (same name)
    rerender({ tools: tools2 });

    // Same reference (stable)
    expect(result.current).toBe(firstResult);
  });

  test('returns new reference when tool names change (added tool)', () => {
    const tools1: ToolsDefinition = { foo: createMockTool() };
    const tools2: ToolsDefinition = { foo: createMockTool(), bar: createMockTool() };

    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: tools1 } }
    );

    const firstResult = result.current;
    rerender({ tools: tools2 });

    // New reference (tool names changed)
    expect(result.current).not.toBe(firstResult);
    expect(Object.keys(result.current!).sort()).toEqual(['bar', 'foo']);
  });

  test('returns new reference when tool names change (removed tool)', () => {
    const tools1: ToolsDefinition = { foo: createMockTool(), bar: createMockTool() };
    const tools2: ToolsDefinition = { foo: createMockTool() };

    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: tools1 } }
    );

    const firstResult = result.current;
    rerender({ tools: tools2 });

    expect(result.current).not.toBe(firstResult);
    expect(Object.keys(result.current!)).toEqual(['foo']);
  });

  test('returns new reference when tool names change (renamed tool)', () => {
    const tools1: ToolsDefinition = { oldName: createMockTool() };
    const tools2: ToolsDefinition = { newName: createMockTool() };

    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: tools1 } }
    );

    const firstResult = result.current;
    rerender({ tools: tools2 });

    expect(result.current).not.toBe(firstResult);
    expect(Object.keys(result.current!)).toEqual(['newName']);
  });

  test('calls latest handler through stable wrapper', () => {
    const handler1 = mock(() => ({ result: 'first' }));
    const handler2 = mock(() => ({ result: 'second' }));

    const tools1: ToolsDefinition = { foo: createMockTool('Tool', handler1) };
    const tools2: ToolsDefinition = { foo: createMockTool('Tool', handler2) };

    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: tools1 } }
    );

    // Call through stable wrapper - should call first handler
    result.current!.foo.fn({});
    expect(handler1).toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();

    // Update to new handler
    rerender({ tools: tools2 });

    // Reset mocks
    handler1.mockClear();
    handler2.mockClear();

    // Same stable wrapper now calls new handler
    result.current!.foo.fn({});
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  test('_execute calls latest handler through stable wrapper', async () => {
    const handler1 = mock(() => ({ result: 'first' }));
    const handler2 = mock(() => ({ result: 'second' }));

    const tools1: ToolsDefinition = { foo: createMockTool('Tool', handler1) };
    const tools2: ToolsDefinition = { foo: createMockTool('Tool', handler2) };

    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: tools1 } }
    );

    // Call through stable _execute - should call first handler
    await result.current!.foo._execute({ value: 'test' });
    expect(handler1).toHaveBeenCalled();

    // Update to new handler
    rerender({ tools: tools2 });
    handler1.mockClear();

    // Same stable wrapper now calls new handler
    await result.current!.foo._execute({ value: 'test' });
    expect(handler2).toHaveBeenCalled();
  });

  test('updates description without changing reference', () => {
    const tools1: ToolsDefinition = { foo: createMockTool('Description 1') };
    const tools2: ToolsDefinition = { foo: createMockTool('Description 2') };

    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: tools1 } }
    );

    const firstResult = result.current;
    expect(firstResult!.foo.description).toBe('Description 1');

    rerender({ tools: tools2 });

    // Same reference
    expect(result.current).toBe(firstResult);
    // But updated description
    expect(result.current!.foo.description).toBe('Description 2');
  });

  test('updates options without changing reference', () => {
    const tool1 = defineTool('Tool', z.object({}), () => ({}), { confirmationRequired: false });
    const tool2 = defineTool('Tool', z.object({}), () => ({}), { confirmationRequired: true });

    const tools1: ToolsDefinition = { foo: tool1 };
    const tools2: ToolsDefinition = { foo: tool2 };

    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: tools1 } }
    );

    const firstResult = result.current;
    expect(firstResult!.foo._options.confirmationRequired).toBe(false);

    rerender({ tools: tools2 });

    // Same reference
    expect(result.current).toBe(firstResult);
    // But updated options
    expect(result.current!.foo._options.confirmationRequired).toBe(true);
  });

  test('throws error when calling handler for removed tool', () => {
    const tools1: ToolsDefinition = { foo: createMockTool() };
    const tools2: ToolsDefinition = { bar: createMockTool() }; // foo removed

    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: tools1 } }
    );

    // Get reference to the stable foo wrapper
    const fooWrapper = result.current!.foo;

    // Update tools (removes foo)
    rerender({ tools: tools2 });

    // Calling the old wrapper should throw
    expect(() => fooWrapper.fn({})).toThrow('Tool "foo" no longer exists');
  });

  test('async handlers work through stable wrapper', async () => {
    const asyncHandler = mock(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { async: true };
    });

    const tools: ToolsDefinition = {
      asyncTool: defineTool('Async tool', z.object({}), asyncHandler),
    };

    const { result } = renderHook(() => useStableTools(tools));

    const response = await result.current!.asyncTool.fn({});
    expect(response).toEqual({ async: true });
    expect(asyncHandler).toHaveBeenCalled();
  });

  test('handles transition from undefined to defined tools', () => {
    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: undefined as ToolsDefinition | undefined } }
    );

    expect(result.current).toBeUndefined();

    rerender({ tools: { foo: createMockTool() } });

    expect(result.current).toBeDefined();
    expect(Object.keys(result.current!)).toEqual(['foo']);
  });

  test('handles transition from defined to undefined tools', () => {
    const { result, rerender } = renderHook(
      ({ tools }) => useStableTools(tools),
      { initialProps: { tools: { foo: createMockTool() } as ToolsDefinition | undefined } }
    );

    expect(result.current).toBeDefined();

    rerender({ tools: undefined });

    expect(result.current).toBeUndefined();
  });

  test('maintains closure values correctly across renders', () => {
    // Simulate a component with state that changes
    const capturedValues: number[] = [];
    let currentValue = 0;

    const createToolsWithClosure = (value: number): ToolsDefinition => ({
      capture: defineTool('Capture value', z.object({}), () => {
        capturedValues.push(value);
        return { captured: value };
      }),
    });

    const { result, rerender } = renderHook(
      ({ value }) => useStableTools(createToolsWithClosure(value)),
      { initialProps: { value: currentValue } }
    );

    // Call with initial value
    result.current!.capture.fn({});
    expect(capturedValues).toEqual([0]);

    // Update value
    currentValue = 1;
    rerender({ value: currentValue });
    result.current!.capture.fn({});
    expect(capturedValues).toEqual([0, 1]);

    // Update again
    currentValue = 42;
    rerender({ value: currentValue });
    result.current!.capture.fn({});
    expect(capturedValues).toEqual([0, 1, 42]);
  });

  test('handles many rapid rerenders without issues', () => {
    const handlers = Array.from({ length: 100 }, (_, i) => mock(() => ({ index: i })));

    const { result, rerender } = renderHook(
      ({ index }) => useStableTools({ tool: createMockTool(`Tool ${index}`, handlers[index]) }),
      { initialProps: { index: 0 } }
    );

    const firstResult = result.current;

    // Rapidly rerender 99 times
    for (let i = 1; i < 100; i++) {
      rerender({ index: i });
      // Reference should remain stable
      expect(result.current).toBe(firstResult);
    }

    // Final handler should be called
    result.current!.tool.fn({});
    expect(handlers[99]).toHaveBeenCalled();
    expect(handlers[0]).not.toHaveBeenCalled();
  });

  test('preserves _toToolDefinition functionality', () => {
    const tools: ToolsDefinition = {
      myTool: defineTool('My tool description', z.object({
        name: z.string(),
        count: z.number(),
      }), (input) => ({ echo: input })),
    };

    const { result } = renderHook(() => useStableTools(tools));

    const toolDef = result.current!.myTool._toToolDefinition('myTool');

    expect(toolDef.name).toBe('myTool');
    expect(toolDef.description).toBe('My tool description');
    expect(toolDef.parameters.type).toBe('object');
    expect(toolDef.parameters.properties).toHaveProperty('name');
    expect(toolDef.parameters.properties).toHaveProperty('count');
  });
});

describe('useStableTools - Integration (render loop prevention)', () => {
  test('simulates useAI pattern: inline tools with state updates do not cause reference changes', () => {
    // This simulates the exact pattern that was causing render loops:
    // - Component with useState
    // - Tools defined inline (not memoized)
    // - Tool handler updates state
    //
    // Without useStableTools, each state update would:
    // 1. Re-render component
    // 2. Create new tools object
    // 3. Trigger effect re-run
    // 4. Re-register tools
    // 5. Potentially cause more renders
    //
    // With useStableTools, the reference stays stable despite state changes.

    let stateValue = 0;
    const stateUpdates: number[] = [];

    // Simulate a component render function that creates inline tools
    const simulateRender = () => ({
      updateValue: defineTool('Update the value', z.object({ newValue: z.number() }), (input) => {
        stateValue = input.newValue;
        stateUpdates.push(input.newValue);
        return { success: true, newValue: stateValue };
      }),
    });

    const { result, rerender } = renderHook(
      () => {
        // Simulate creating tools inline (like useAI pattern)
        const inlineTools = simulateRender();
        return useStableTools(inlineTools);
      }
    );

    const initialStableRef = result.current;

    // Simulate 10 state updates (like tool executions updating state)
    for (let i = 1; i <= 10; i++) {
      // Execute the tool (updates stateValue)
      result.current!.updateValue.fn({ newValue: i });

      // "Re-render" (simulates React re-rendering after state update)
      rerender({});

      // Reference should remain stable
      expect(result.current).toBe(initialStableRef);
    }

    // Verify all updates were captured correctly (fresh closures)
    expect(stateUpdates).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(stateValue).toBe(10);
  });

  test('reference only changes when tool names actually change', () => {
    const referenceChanges: number[] = [];
    let prevRef: ToolsDefinition | undefined;

    const { result, rerender } = renderHook(
      ({ toolNames }: { toolNames: string[] }) => {
        const tools: ToolsDefinition = {};
        for (const name of toolNames) {
          tools[name] = createMockTool(`Tool: ${name}`);
        }
        const stable = useStableTools(tools);

        // Track reference changes
        if (stable !== prevRef) {
          referenceChanges.push(toolNames.length);
        }
        prevRef = stable;

        return stable;
      },
      { initialProps: { toolNames: ['foo', 'bar'] } }
    );

    // Initial: reference created
    expect(referenceChanges).toEqual([2]);

    // Same names, different objects: no change
    rerender({ toolNames: ['foo', 'bar'] });
    expect(referenceChanges).toEqual([2]);

    // Add a tool: reference changes
    rerender({ toolNames: ['foo', 'bar', 'baz'] });
    expect(referenceChanges).toEqual([2, 3]);

    // Same names again: no change
    rerender({ toolNames: ['foo', 'bar', 'baz'] });
    rerender({ toolNames: ['foo', 'bar', 'baz'] });
    rerender({ toolNames: ['foo', 'bar', 'baz'] });
    expect(referenceChanges).toEqual([2, 3]);

    // Remove a tool: reference changes
    rerender({ toolNames: ['foo', 'bar'] });
    expect(referenceChanges).toEqual([2, 3, 2]);

    // Order doesn't matter (sorted internally)
    rerender({ toolNames: ['bar', 'foo'] });
    expect(referenceChanges).toEqual([2, 3, 2]); // Still same reference

    // Rename a tool: reference changes
    rerender({ toolNames: ['foo', 'qux'] });
    expect(referenceChanges).toEqual([2, 3, 2, 2]);
  });

  test('effect dependencies work correctly with toolsKey pattern', () => {
    // This simulates how useAI uses both stableTools and toolsKey for effects
    const effectRuns: string[] = [];

    const { result, rerender } = renderHook(
      ({ tools }: { tools: ToolsDefinition }) => {
        const stableTools = useStableTools(tools);
        const toolsKey = Object.keys(tools).sort().join(',');

        // Simulate effect tracking
        return { stableTools, toolsKey };
      },
      { initialProps: { tools: { foo: createMockTool() } as ToolsDefinition } }
    );

    const initialToolsKey = result.current.toolsKey;
    const initialStableRef = result.current.stableTools;

    // Rerender with new object but same tools
    rerender({ tools: { foo: createMockTool() } });
    expect(result.current.toolsKey).toBe(initialToolsKey);
    expect(result.current.stableTools).toBe(initialStableRef);

    // Rerender with different tools
    rerender({ tools: { foo: createMockTool(), bar: createMockTool() } });
    expect(result.current.toolsKey).not.toBe(initialToolsKey);
    expect(result.current.stableTools).not.toBe(initialStableRef);
  });
});
