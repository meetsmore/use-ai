import type { McpHeadersMap } from '@meetsmore-oss/use-ai-core';
import type { ClientSession, AgentInput } from '../agents/types';
import type { UseAIClientMessage } from '../types';

/**
 * Message handler function type for plugin-registered message handlers.
 *
 * @param session - The client session context
 * @param message - The incoming message from the client
 */
export type MessageHandler = (session: ClientSession, message: UseAIClientMessage) => Promise<void> | void;

/**
 * Result from a beforeRunAgent or beforeRunAuthorized hook indicating the run should be aborted.
 * Return this from either hook to block the run and send the message to the client as RUN_ERROR.
 */
export interface BeforeRunAgentResult {
  abort: true;
  message: string;
}

/**
 * Input passed to beforeRunAuthorized hooks.
 *
 * beforeRunAuthorized runs before any external call for the run (MCP `tools/list`, attachment
 * resolution), so messages and tools are not built yet; the raw client request is in
 * `originalInput`.
 */
export interface BeforeRunAuthorizedInput {
  /**
   * The client session context. `threadId`, `currentRunId` and `abortController` are already set
   * for this run; `tools` and `state` still hold the previous run's values (read them from
   * `originalInput`).
   */
  session: ClientSession;
  /** The unique identifier for this run */
  runId: string;
  /** The raw RunAgentInput sent by the client (messages, client tools, state, forwardedProps) */
  originalInput: AgentInput['originalInput'];
  /**
   * MCP headers used for this run, initially `forwardedProps.mcpHeaders` from the client.
   * A hook may reassign this (e.g. to swap a client token for a server-issued one);
   * the final value is what the server sends to MCP endpoints.
   */
  mcpHeaders?: McpHeadersMap;
}

/**
 * Plugin interface for extending UseAIServer functionality.
 *
 * Plugins can register custom message handlers, react to client lifecycle events,
 * and add new capabilities to the server without modifying core code.
 *
 * @example
 * ```typescript
 * class FeedbackPlugin implements UseAIServerPlugin {
 *   getName() {
 *     return 'feedback';
 *   }
 *
 *   registerHandlers(server) {
 *     server.registerMessageHandler('message_feedback', async (session, message) => {
 *       // Handle the feedback message
 *     });
 *   }
 *
 *   onClientConnect(session) {
 *     console.log('Client connected:', session.clientId);
 *   }
 *
 *   onClientDisconnect(session) {
 *     console.log('Client disconnected:', session.clientId);
 *   }
 * }
 * ```
 */
export interface UseAIServerPlugin {
  /**
   * Returns the unique identifier for this plugin.
   * Used for logging and debugging purposes.
   *
   * @returns Plugin name (e.g., 'feedback', 'analytics', 'auth')
   */
  getName(): string;

  /**
   * Called when the plugin is registered with the server.
   * Use this to register custom message handlers.
   *
   * @param server - Object with registerMessageHandler method
   */
  registerHandlers(server: {
    registerMessageHandler(type: string, handler: MessageHandler): void;
  }): void;

  /**
   * Optional lifecycle hook called when a client connects.
   *
   * @param session - The newly created client session
   */
  onClientConnect?(session: ClientSession): void;

  /**
   * Optional lifecycle hook called when a client disconnects.
   *
   * @param session - The disconnecting client session
   */
  onClientDisconnect?(session: ClientSession): void;

  /**
   * Optional hook called first for every run, before any external call (MCP `tools/list`,
   * attachment resolution). Use this for authentication, so a rejected run causes no
   * outbound requests.
   *
   * Return `{ abort: true, message: '...' }` to block the run. The message is sent
   * to the client as a RUN_ERROR event. Return `void` (or `undefined`) to allow the run.
   * Reassign `input.mcpHeaders` to change the headers sent to MCP endpoints for this run.
   *
   * @param input - The raw run request and the MCP headers for this run
   * @returns Promise resolving to an abort result or void
   */
  beforeRunAuthorized?(input: BeforeRunAuthorizedInput): Promise<BeforeRunAgentResult | void>;

  /**
   * Optional hook called before an agent run starts.
   * Use this to perform pre-run checks that need the built run input, such as quota enforcement.
   *
   * Runs after MCP `tools/list` and attachment resolution. Do authentication in
   * `beforeRunAuthorized` instead, so unauthenticated runs cannot trigger those external calls.
   *
   * Return `{ abort: true, message: '...' }` to block the run — the message is sent
   * to the client as a RUN_ERROR event. Return `void` (or `undefined`) to allow the run.
   *
   * @param input - The agent input containing session, messages, tools, and state
   * @returns Promise resolving to an abort result or void
   */
  beforeRunAgent?(input: AgentInput): Promise<BeforeRunAgentResult | void>;

  /**
   * Optional cleanup hook called when the server is shutting down.
   * Use this to flush pending data, close connections, etc.
   *
   * @returns Promise that resolves when cleanup is complete
   */
  close?(): Promise<void>;
}
