import { describe, test, expect } from 'bun:test';
import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

/**
 * Test to verify message sanitization removes provider-specific fields.
 *
 * The issue occurs when messages from a previous API response are reused in a subsequent
 * request, and those messages contain provider-specific fields like `tool_use_id`.
 */
describe('Message Sanitization', () => {
  // Zod schemas matching AISDKAgent (for testing sanitization logic)
  const toolResultContentSchema = z.object({
    type: z.literal('tool-result'),
    toolCallId: z.string(),
    toolName: z.string(),
    output: z.unknown(),
    isError: z.boolean().optional(),
  });

  const messageSchema = z.object({
    role: z.enum(['user', 'assistant', 'tool', 'system']),
    content: z.union([z.string(), z.array(z.any())]),
  });

  test('should strip tool_use_id from tool-result blocks using Zod', () => {
    const messageWithExtraFields: any = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'toolu_01ABC',
          toolName: 'add',
          output: { sum: 8 },
          tool_use_id: 'toolu_01ABC', // This should be stripped
          extra_field: 'should be removed', // This should be stripped
        },
      ],
    };

    // Sanitize using Zod parse (strips extra fields)
    const sanitized = messageSchema.parse(messageWithExtraFields);

    // Content array should be preserved
    expect(Array.isArray(sanitized.content)).toBe(true);

    // Parse the tool-result block specifically
    const toolResultBlock = (sanitized.content as any[])[0];
    const sanitizedBlock = toolResultContentSchema.parse(toolResultBlock);

    // Should have the required fields
    expect(sanitizedBlock.type).toBe('tool-result');
    expect(sanitizedBlock.toolCallId).toBe('toolu_01ABC');
    expect(sanitizedBlock.toolName).toBe('add');
    expect(sanitizedBlock.output).toEqual({ sum: 8 });

    // Should NOT have provider-specific fields
    expect('tool_use_id' in sanitizedBlock).toBe(false);
    expect('extra_field' in sanitizedBlock).toBe(false);
  });
});
