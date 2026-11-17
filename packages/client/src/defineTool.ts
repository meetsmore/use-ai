import { z } from 'zod';
import type { ToolDefinition, ToolAnnotations } from '@meetsmore-oss/use-ai-core';

// Re-export ToolAnnotations for convenience
export type { ToolAnnotations };

/**
 * Context provided to tool execution functions.
 * Allows tools to dynamically request user approval at runtime.
 */
export interface ToolExecutionContext {
  /**
   * Request user approval during tool execution.
   * Use this for conditional approval based on runtime values
   * (e.g., API endpoint, input values, computed risk).
   *
   * @param input - Approval request details
   * @returns Promise resolving with approval decision
   *
   * @example
   * ```typescript
   * const callApi = defineTool(
   *   'Call an external API',
   *   z.object({ url: z.string() }),
   *   async (input, ctx) => {
   *     if (input.url.includes('production')) {
   *       const { approved } = await ctx.requestApproval({
   *         message: `This will call production API: ${input.url}`,
   *       });
   *       if (!approved) return { error: 'User rejected the action' };
   *     }
   *     return fetch(input.url);
   *   }
   * );
   * ```
   */
  requestApproval(input: {
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ approved: boolean; reason?: string }>;
}

/**
 * Options for configuring tool behavior.
 */
export interface ToolOptions {
  /** MCP-aligned annotations for tool behavior hints */
  annotations?: ToolAnnotations;
}

/**
 * JSON Schema representation type (simplified)
 */
interface JSONSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean | Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * A tool definition with validation schema and execution function.
 * Created by the `defineTool` function and used to define tools that the AI can call.
 *
 * @template T - The Zod schema type for validating tool input
 */
export interface DefinedTool<T extends z.ZodType> {
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON Schema representation of the input schema */
  _jsonSchema: JSONSchema;
  /** Zod schema for validating input */
  _zodSchema: T;
  /** The function to execute when the tool is called */
  fn: (input: z.infer<T>, ctx: ToolExecutionContext) => unknown | Promise<unknown>;
  /** Configuration options for the tool */
  _options: ToolOptions;
  /** Converts this tool to a ToolDefinition for registration with the server */
  _toToolDefinition: (name: string) => ToolDefinition;
  /** Validates input and executes the tool function */
  _execute: (input: unknown, ctx: ToolExecutionContext) => Promise<unknown>;
}

/**
 * Defines a tool with no input parameters that can be called by the AI.
 *
 * @template TReturn - The return type of the tool function
 * @param description - Human-readable description of what the tool does
 * @param fn - The function to execute when the tool is called
 * @param options - Optional configuration for the tool
 * @returns A DefinedTool that can be registered with useAI
 *
 * @example
 * ```typescript
 * const getCurrentTime = defineTool(
 *   'Get the current time',
 *   () => new Date().toISOString()
 * );
 * ```
 */
export function defineTool<TReturn>(
  description: string,
  fn: (ctx: ToolExecutionContext) => TReturn | Promise<TReturn>,
  options?: ToolOptions
): DefinedTool<z.ZodObject<{}>>;

/**
 * Defines a tool with typed input parameters that can be called by the AI.
 *
 * @template TSchema - The Zod schema type for validating input
 * @param description - Human-readable description of what the tool does
 * @param schema - Zod schema defining the tool's input parameters
 * @param fn - The function to execute when the tool is called
 * @param options - Optional configuration for the tool
 * @returns A DefinedTool that can be registered with useAI
 *
 * @example
 * ```typescript
 * import { defineTool } from '@meetsmore-oss/use-ai-client';
 * import { z } from 'zod';
 *
 * const addTodo = defineTool(
 *   'Add a new todo item',
 *   z.object({ text: z.string() }),
 *   (input) => {
 *     todos.push({ id: Date.now(), text: input.text, completed: false });
 *     return { success: true };
 *   }
 * );
 * ```
 */
export function defineTool<TSchema extends z.ZodType>(
  description: string,
  schema: TSchema,
  fn: (input: z.infer<TSchema>, ctx: ToolExecutionContext) => unknown | Promise<unknown>,
  options?: ToolOptions
): DefinedTool<TSchema>;

/**
 * @internal
 * Implementation of defineTool that handles both overloads
 */
export function defineTool<T extends z.ZodType>(
  description: string,
  schemaOrFn: T | ((ctx: ToolExecutionContext) => unknown),
  fnOrOptions?: ((input: z.infer<T>, ctx: ToolExecutionContext) => unknown | Promise<unknown>) | ToolOptions,
  options?: ToolOptions
): DefinedTool<T> {
  const isNoParamFunction = typeof schemaOrFn === 'function';
  const schema = (isNoParamFunction ? z.object({}) : schemaOrFn) as T;

  let actualFn: (input: z.infer<T>, ctx: ToolExecutionContext) => unknown | Promise<unknown>;
  let actualOptions: ToolOptions;

  if (isNoParamFunction) {
    // Wrap no-param function: user writes (ctx?) => ..., we adapt to (input, ctx) => ...
    const noParamFn = schemaOrFn as (ctx: ToolExecutionContext) => unknown | Promise<unknown>;
    actualFn = (_input: z.infer<T>, ctx: ToolExecutionContext) => noParamFn(ctx);
    actualOptions = (fnOrOptions as ToolOptions) || {};
  } else {
    actualFn = fnOrOptions as (input: z.infer<T>, ctx: ToolExecutionContext) => unknown | Promise<unknown>;
    actualOptions = options || {};
  }

  const jsonSchema = z.toJSONSchema(schema) as JSONSchema;

  return {
    description,
    _jsonSchema: jsonSchema,
    _zodSchema: schema,
    fn: actualFn,
    _options: actualOptions,

    _toToolDefinition(name: string): ToolDefinition {
      const parameters: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean | Record<string, unknown>;
      } = {
        type: 'object',
        properties: (this._jsonSchema.properties || {}) as Record<string, unknown>,
      };

      if (this._jsonSchema.required && this._jsonSchema.required.length > 0) {
        parameters.required = this._jsonSchema.required;
      }

      if (this._jsonSchema.additionalProperties !== undefined) {
        parameters.additionalProperties = this._jsonSchema.additionalProperties as boolean | Record<string, unknown>;
      }

      const toolDef: ToolDefinition = {
        name,
        description,
        parameters,
      };

      // Pass through annotations if present
      if (this._options.annotations) {
        toolDef.annotations = this._options.annotations;
      }

      return toolDef;
    },

    async _execute(input: unknown, ctx: ToolExecutionContext) {
      const validated = this._zodSchema.parse(input);
      return await actualFn(validated, ctx);
    },
  };
}

/**
 * A collection of named tools.
 * Used to register multiple tools with the useAI hook.
 */
export type ToolsDefinition = Record<string, DefinedTool<z.ZodType>>;

/**
 * Converts a ToolsDefinition to an array of ToolDefinition objects.
 *
 * @param tools - The tools to convert
 * @returns Array of tool definitions suitable for server registration
 * @internal
 */
export function convertToolsToDefinitions(tools: ToolsDefinition): ToolDefinition[] {
  return Object.entries(tools).map(([name, tool]) => tool._toToolDefinition(name));
}

/**
 * Executes a defined tool by name with the provided input.
 *
 * @param tools - The collection of available tools
 * @param toolName - The name of the tool to execute
 * @param input - The input parameters for the tool
 * @returns The result of executing the tool
 * @throws Error if the tool is not found
 * @internal
 */
export async function executeDefinedTool(
  tools: ToolsDefinition,
  toolName: string,
  input: unknown,
  ctx: ToolExecutionContext
): Promise<unknown> {
  const tool = tools[toolName];
  if (!tool) {
    throw new Error(`Tool "${toolName}" not found`);
  }
  return await tool._execute(input, ctx);
}
