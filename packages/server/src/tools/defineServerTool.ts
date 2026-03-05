import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ToolAnnotations } from '../types';
import type { ServerToolConfig, ServerToolContext, ServerToolExecuteFn } from './types';

/**
 * Options for configuring server tool behavior.
 */
interface ServerToolOptions {
  /** MCP-aligned annotations for tool behavior hints */
  annotations?: ToolAnnotations;
}

/**
 * Defines a server tool with no input parameters.
 *
 * @param description - Human-readable description of what the tool does
 * @param execute - The function to execute when the AI calls this tool
 * @param options - Optional annotations for tool behavior hints
 * @returns ServerToolConfig for use in UseAIServerConfig.tools
 *
 * @example
 * ```typescript
 * const getServerTime = defineServerTool(
 *   'Get the current server time',
 *   async () => new Date().toISOString()
 * );
 * ```
 */
export function defineServerTool(
  description: string,
  execute: (args: Record<string, never>, context: ServerToolContext) => unknown | Promise<unknown>,
  options?: ServerToolOptions
): ServerToolConfig;

/**
 * Defines a server tool with typed input parameters via Zod schema.
 *
 * @param description - Human-readable description of what the tool does
 * @param schema - Zod schema defining the tool's input parameters
 * @param execute - The typed function to execute when the AI calls this tool
 * @param options - Optional annotations for tool behavior hints
 * @returns ServerToolConfig for use in UseAIServerConfig.tools
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 *
 * const getWeather = defineServerTool(
 *   'Get current weather for a city',
 *   z.object({ city: z.string() }),
 *   async ({ city }) => {
 *     const res = await fetch(`https://api.weather.com/${city}`);
 *     return res.json();
 *   },
 *   { annotations: { readOnlyHint: true } }
 * );
 * ```
 */
export function defineServerTool<TSchema extends z.ZodType>(
  description: string,
  schema: TSchema,
  execute: (args: z.infer<TSchema>, context: ServerToolContext) => unknown | Promise<unknown>,
  options?: ServerToolOptions
): ServerToolConfig;

/**
 * @internal
 * Implementation of defineServerTool that handles both overloads.
 */
export function defineServerTool<TSchema extends z.ZodType>(
  description: string,
  schemaOrExecute: TSchema | ServerToolExecuteFn,
  executeOrOptions?: ServerToolExecuteFn | ServerToolOptions,
  options?: ServerToolOptions
): ServerToolConfig {
  const isNoParamForm = typeof schemaOrExecute === 'function';

  let parameters: ServerToolConfig['parameters'];
  let execute: ServerToolExecuteFn;
  let actualOptions: ServerToolOptions;

  if (isNoParamForm) {
    parameters = { type: 'object', properties: {} };
    execute = schemaOrExecute as ServerToolExecuteFn;
    actualOptions = (executeOrOptions as ServerToolOptions) || {};
  } else {
    const schema = schemaOrExecute as TSchema;
    const jsonSchema = zodToJsonSchema(schema, { target: 'openApi3' }) as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    parameters = {
      type: 'object',
      properties: (jsonSchema.properties || {}) as Record<string, unknown>,
    };
    if (jsonSchema.required && jsonSchema.required.length > 0) {
      parameters.required = jsonSchema.required;
    }
    execute = executeOrOptions as ServerToolExecuteFn;
    actualOptions = options || {};
  }

  const config: ServerToolConfig = {
    description,
    parameters,
    execute,
  };

  if (actualOptions.annotations) {
    config.annotations = actualOptions.annotations;
  }

  return config;
}
