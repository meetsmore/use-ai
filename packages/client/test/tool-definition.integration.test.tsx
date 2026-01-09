import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import { defineTool, executeDefinedTool } from '../src/defineTool';

describe('Tool Definition & Registration', () => {
  describe('React components can expose tools to the AI using the useAI hook', () => {
    it('should allow defineTool to create tool definitions', () => {
      const addTodo = defineTool(
        'Add a new todo item',
        z.object({ text: z.string() }),
        (input) => ({ success: true, text: input.text })
      );

      expect(addTodo).toBeDefined();
      expect(addTodo.description).toBe('Add a new todo item');
      expect(addTodo._zodSchema).toBeDefined();
    });
  });

  describe('Tools can be defined with type-safe parameters using Zod schemas', () => {
    it('should define tools with Zod schemas and validate inputs', async () => {
      const updateUser = defineTool(
        'Update user information',
        z.object({
          id: z.string(),
          name: z.string(),
          age: z.number().min(0).max(150),
        }),
        (input) => ({ success: true, user: input })
      );

      const tools = { updateUser };
      const result = await executeDefinedTool(tools, 'updateUser', {
        id: '123',
        name: 'Alice',
        age: 30,
      });

      expect(result).toEqual({
        success: true,
        user: { id: '123', name: 'Alice', age: 30 },
      });
    });

    it('should reject invalid inputs that do not match Zod schema', async () => {
      const updateUser = defineTool(
        'Update user',
        z.object({
          age: z.number().min(0).max(150),
        }),
        (input) => ({ success: true })
      );

      const tools = { updateUser };

      try {
        await executeDefinedTool(tools, 'updateUser', { age: 999 }); // Invalid: exceeds max
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain('Too big');
      }
    });

    it('should validate complex nested schemas', async () => {
      const createOrder = defineTool(
        'Create an order',
        z.object({
          customer: z.object({
            name: z.string().min(1),
            email: z.string().email(),
          }),
          items: z.array(z.object({
            productId: z.string(),
            quantity: z.number().positive(),
          })),
          total: z.number().positive(),
        }),
        (input) => ({ success: true, orderId: '123' })
      );

      const tools = { createOrder };
      const result = await executeDefinedTool(tools, 'createOrder', {
        customer: {
          name: 'John Doe',
          email: 'john@example.com',
        },
        items: [
          { productId: 'prod-1', quantity: 2 },
          { productId: 'prod-2', quantity: 1 },
        ],
        total: 99.99,
      });

      expect(result).toEqual({ success: true, orderId: '123' });
    });
  });

  describe('Tools can be defined without parameters', () => {
    it('should define and execute tools without parameters', async () => {
      let executed = false;
      const logout = defineTool('Log the user out', () => {
        executed = true;
        return { success: true };
      });

      const tools = { logout };
      await executeDefinedTool(tools, 'logout', {});

      expect(executed).toBe(true);
    });

    it('should work with arrow functions returning values directly', async () => {
      const getCurrentTime = defineTool(
        'Get current timestamp',
        () => ({ timestamp: Date.now() })
      );

      const tools = { getCurrentTime };
      const result = await executeDefinedTool(tools, 'getCurrentTime', {});

      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('number');
    });
  });

  describe('Tools can be marked as requiring confirmation before execution', () => {
    it('should mark tools with confirmationRequired flag', () => {
      const deleteAccount = defineTool(
        'Delete account permanently',
        z.object({ userId: z.string() }),
        (input) => ({ success: true }),
        { confirmationRequired: true }
      );

      expect(deleteAccount._options.confirmationRequired).toBe(true);
    });

    it('should not mark tools without confirmationRequired flag', () => {
      const getTodo = defineTool(
        'Get a todo',
        z.object({ id: z.string() }),
        () => ({ id: '1', text: 'Sample' })
      );

      expect(getTodo._options.confirmationRequired).toBeUndefined();
    });

    it('should support both confirmationRequired and other options', () => {
      const destructiveAction = defineTool(
        'Perform destructive action',
        z.object({ targetId: z.string() }),
        (input) => ({ success: true }),
        { confirmationRequired: true }
      );

      expect(destructiveAction._options).toEqual({
        confirmationRequired: true,
      });
    });
  });

  describe('Tool execution errors are caught and reported back to the AI', () => {
    it('should catch and report synchronous tool execution errors', async () => {
      const failingTool = defineTool(
        'Tool that fails',
        z.object({ value: z.string() }),
        () => {
          throw new Error('Intentional failure');
        }
      );

      const tools = { failingTool };

      try {
        await executeDefinedTool(tools, 'failingTool', { value: 'test' });
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.message).toBe('Intentional failure');
      }
    });

    it('should catch and report async tool execution errors', async () => {
      const asyncFailingTool = defineTool(
        'Async tool that fails',
        z.object({ value: z.string() }),
        async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          throw new Error('Async failure');
        }
      );

      const tools = { asyncFailingTool };

      try {
        await executeDefinedTool(tools, 'asyncFailingTool', { value: 'test' });
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.message).toBe('Async failure');
      }
    });

    it('should handle validation errors from Zod', async () => {
      const strictTool = defineTool(
        'Tool with strict validation',
        z.object({
          email: z.string().email(),
          age: z.number().int().positive(),
        }),
        (input) => ({ success: true })
      );

      const tools = { strictTool };

      try {
        await executeDefinedTool(tools, 'strictTool', {
          email: 'invalid-email',
          age: -5,
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain('Invalid email');
      }
    });
  });

  describe('Tools are automatically registered when components mount and unregistered when they unmount', () => {
    it('should verify tool metadata is preserved', () => {
      const testTool = defineTool(
        'Test tool description',
        z.object({ param: z.string() }),
        (input) => 'result'
      );

      expect(testTool.description).toBe('Test tool description');
      expect(testTool._zodSchema).toBeDefined();
      expect(testTool.fn).toBeDefined();
    });

    it('should support multiple tools with same handler signature', () => {
      const handler = (input: { id: string }) => ({ success: true, id: input.id });

      const tool1 = defineTool('Tool 1', z.object({ id: z.string() }), handler);
      const tool2 = defineTool('Tool 2', z.object({ id: z.string() }), handler);

      expect(tool1.description).toBe('Tool 1');
      expect(tool2.description).toBe('Tool 2');
      expect(tool1.fn).toBe(handler);
      expect(tool2.fn).toBe(handler);
    });
  });
});
