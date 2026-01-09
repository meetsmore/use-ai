import { describe, test, expect } from 'bun:test';
import { z } from 'zod';
import { defineTool } from './defineTool';

describe('Tools can be defined with type-safe parameters using Zod schemas', () => {
  test('defines a tool with Zod schema and typed parameters', async () => {
    const schema = z.object({
      a: z.number(),
      b: z.number(),
    });

    const tool = defineTool(
      'Adds two numbers',
      schema,
      (input) => input.a + input.b
    );

    const result = await tool._execute({ a: 5, b: 3 });
    expect(result).toBe(8);
  });

  test('provides type safety between schema and function parameters', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    // These should fail TypeScript compilation - accessing properties not in schema
    const invalidTool1 = defineTool(
      'Invalid tool',
      schema,
      // @ts-expect-error - accessing non-existent property 'email'
      (input) => input.email
    );

    const invalidTool2 = defineTool(
      'Invalid tool',
      schema,
      // @ts-expect-error - accessing non-existent property 'address'
      (input) => input.address.street
    );

    expect(invalidTool1).toBeDefined();
    expect(invalidTool2).toBeDefined();
  });

  test('validates input against Zod schema at runtime', async () => {
    const schema = z.object({
      email: z.string().email(),
    });

    const tool = defineTool(
      'Validates email',
      schema,
      (input) => `Valid email: ${input.email}`
    );

    await expect(tool._execute({ email: 'invalid-email' })).rejects.toThrow();
  });

  test('supports complex Zod schemas with nested objects', async () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        age: z.number(),
      }),
      metadata: z.object({
        timestamp: z.number(),
      }),
    });

    const tool = defineTool(
      'Process user data',
      schema,
      (input) => `${input.user.name} is ${input.user.age} years old`
    );

    const result = await tool._execute({
      user: { name: 'Alice', age: 30 },
      metadata: { timestamp: 123456 },
    });
    expect(result).toBe('Alice is 30 years old');
  });

  test('supports Zod schemas with optional fields', async () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });

    const tool = defineTool(
      'Handle optional fields',
      schema,
      (input) => input.optional ? `${input.required}-${input.optional}` : input.required
    );

    expect(await tool._execute({ required: 'test' })).toBe('test');
    expect(await tool._execute({ required: 'test', optional: 'extra' })).toBe('test-extra');
  });

  test('converts Zod schema to JSON Schema for AG-UI protocol', () => {
    const schema = z.object({
      text: z.string(),
      count: z.number(),
    });

    const tool = defineTool('Test tool', schema, (input) => input.text);
    const definition = tool._toToolDefinition('myTool');

    expect(definition.name).toBe('myTool');
    expect(definition.description).toBe('Test tool');
    expect(definition.parameters).toBeDefined();
    expect(definition.parameters.type).toBe('object');
    expect(definition.parameters.properties).toBeDefined();
    expect(definition.parameters.properties.text).toBeDefined();
    expect(definition.parameters.properties.count).toBeDefined();
  });
});

describe('Tools can be defined without parameters', () => {
  test('defines a parameterless tool that returns a value', async () => {
    const tool = defineTool('Returns a number', () => 42);

    const result = await tool._execute({});
    expect(result).toBe(42);
  });

  test('defines a parameterless tool with no arguments in function signature', async () => {
    const tool = defineTool('Get current time', () => new Date().toISOString());

    const result = await tool._execute({});
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });

  test('supports async parameterless tools', async () => {
    const tool = defineTool(
      'Async operation',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'done';
      }
    );

    const result = await tool._execute({});
    expect(result).toBe('done');
  });

  test('converts parameterless tool to AG-UI definition with empty object schema', () => {
    const tool = defineTool('Test tool', () => 'result');
    const definition = tool._toToolDefinition('noParamTool');

    expect(definition.name).toBe('noParamTool');
    expect(definition.description).toBe('Test tool');
    expect(definition.parameters).toBeDefined();
    expect(definition.parameters.type).toBe('object');
    expect(definition.parameters.properties).toEqual({});
  });

  test('executes parameterless tool with empty input object', async () => {
    let executed = false;
    const tool = defineTool('Side effect tool', () => {
      executed = true;
      return 'executed';
    });

    await tool._execute({});
    expect(executed).toBe(true);
  });
});

describe('Tools can be marked as requiring confirmation before execution', () => {
  test('includes confirmationRequired flag in tool options', () => {
    const tool = defineTool(
      'Dangerous operation',
      () => 'deleted',
      { confirmationRequired: true }
    );

    expect(tool._options.confirmationRequired).toBe(true);
  });

  test('includes confirmationRequired in AG-UI tool definition when set', () => {
    const tool = defineTool(
      'Delete account',
      () => 'deleted',
      { confirmationRequired: true }
    );

    const definition = tool._toToolDefinition('deleteAccount');
    expect(definition.confirmationRequired).toBe(true);
  });

  test('omits confirmationRequired from definition when not set', () => {
    const tool = defineTool('Safe operation', () => 'done');

    const definition = tool._toToolDefinition('safeOp');
    expect(definition.confirmationRequired).toBeUndefined();
  });

  test('supports confirmationRequired with parameterized tools', () => {
    const schema = z.object({
      userId: z.string(),
    });

    const tool = defineTool(
      'Delete user',
      schema,
      (input) => `Deleted user ${input.userId}`,
      { confirmationRequired: true }
    );

    expect(tool._options.confirmationRequired).toBe(true);

    const definition = tool._toToolDefinition('deleteUser');
    expect(definition.confirmationRequired).toBe(true);
  });

  test('defaults confirmationRequired to undefined when not specified', () => {
    const tool = defineTool('Regular operation', () => 'done');

    expect(tool._options.confirmationRequired).toBeUndefined();
  });
});

describe('Additional tool definition functionality', () => {
  test('supports synchronous and asynchronous tool functions', async () => {
    const syncTool = defineTool('Sync tool', () => 'sync result');
    const asyncTool = defineTool('Async tool', async () => 'async result');

    expect(await syncTool._execute({})).toBe('sync result');
    expect(await asyncTool._execute({})).toBe('async result');
  });

  test('preserves tool description in definition', () => {
    const description = 'This is a detailed description of what the tool does';
    const tool = defineTool(description, () => 'result');

    expect(tool.description).toBe(description);
    expect(tool._toToolDefinition('test').description).toBe(description);
  });

  test('handles tool execution errors gracefully', async () => {
    const tool = defineTool('Error tool', () => {
      throw new Error('Tool execution failed');
    });

    await expect(tool._execute({})).rejects.toThrow('Tool execution failed');
  });
});
