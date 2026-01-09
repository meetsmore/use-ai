import { tool, jsonSchema, type Tool, type ToolCallOptions } from 'ai';
import {
    createClientToolExecutor,
    isRemoteTool,
    type ClientSession,
    type ToolDefinition,
} from '@meetsmore-oss/use-ai-server';

/**
 * Mastra extends the AI SDK ToolCallOptions by nesting toolCallId under agent.
 * This type represents the options object passed to tool execute functions when
 * running through Mastra workflows.
 */
interface MastraToolCallOptions extends ToolCallOptions {
    agent?: { toolCallId?: string };
}

/**
 * Options for converting use-ai tools to AI SDK format
 */
export interface ConvertToolsToAISDKFormatOptions {
    /** Array of tool definitions in use-ai format */
    tools: ToolDefinition[];
    /** Client session (uses pendingToolCalls) */
    session: ClientSession;
}

/**
 * Tool result type - tools can return any value
 */
type ToolResult = unknown;

/**
 * Tool parameters in JSON Schema format
 * @see https://json-schema.org/understanding-json-schema/
 */
interface JSONSchemaToolParameters {
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    required?: string[];
}

/**
 * JSON Schema property definition
 */
interface JSONSchemaProperty {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description?: string;
    enum?: string[];
    items?: JSONSchemaProperty;
    properties?: Record<string, JSONSchemaProperty>;
    required?: string[];
}

/**
 * Tool execution result type
 * JSON-serializable values
 */
type ToolExecutionResult = Record<string, unknown> | string | number | boolean | null;

/**
 * Converts use-ai ToolDefinition to AI SDK format tools.
 *
 * Uses the shared createClientToolExecutor which handles
 * client response handling. AG-UI events should be emitted
 * separately by the caller.
 *
 * This utility is useful for agents that need to execute client-side tools
 * through external AI providers (like Mastra workflows).
 *
 * @param options - Conversion options containing tools and session
 * @returns Tool objects in AI SDK format, keyed by tool name
 */
export function convertToolsToAISDKFormat(
    options: ConvertToolsToAISDKFormatOptions
): Record<string, Tool> {
    const { tools, session } = options;
    const result: Record<string, Tool> = {};
    const executor = createClientToolExecutor(session);

    for (const toolDef of tools) {
        const parameters = toolDef.parameters as JSONSchemaToolParameters;

        result[toolDef.name] = tool<Record<string, unknown>, ToolExecutionResult>({
            description: toolDef.description,
            inputSchema: jsonSchema<Record<string, unknown>>(parameters),
            execute: async (rawArgs: Record<string, unknown>, options: MastraToolCallOptions) => {
                // Mastra passes toolCallId in options.agent.toolCallId, not options.toolCallId
                const toolCallId = options.agent?.toolCallId ?? options.toolCallId;
                if (!toolCallId) {
                    throw new Error('toolCallId is required for tool execution');
                }
                // Mastra wraps tool arguments in a context object.
                // We need to unwrap them to get the actual arguments.
                // We check for the presence of 'context' and 'mastra' properties to identify the wrapper.
                // Guard against undefined/null rawArgs (can happen with no-argument tools)
                const args = (
                    rawArgs?.context && rawArgs?.mastra
                        ? rawArgs.context
                        : rawArgs ?? {}
                ) as Record<string, unknown>;

                // If it's a remote MCP tool, execute it on the server
                if (isRemoteTool(toolDef)) {
                    return toolDef._remote.provider.executeTool(toolDef._remote.originalName, args, session.currentMcpHeaders);
                }
                // Otherwise delegate to client
                return executor(args, { toolCallId }) as Promise<ToolExecutionResult>;
            },
        }) as Tool;
    }

    return result;
}
