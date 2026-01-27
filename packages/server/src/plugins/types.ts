import type { ClientSession } from '../agents/types';
import type { UseAIClientMessage } from '../types';

/**
 * Message handler function type for plugin-registered message handlers.
 *
 * @param session - The client session context
 * @param message - The incoming message from the client
 */
export type MessageHandler = (session: ClientSession, message: UseAIClientMessage) => Promise<void> | void;

/**
 * Plugin interface for extending UseAIServer functionality.
 *
 * Plugins can register custom message handlers, react to client lifecycle events,
 * and add new capabilities to the server without modifying core code.
 *
 * @example
 * ```typescript
 * class WorkflowsPlugin implements UseAIServerPlugin {
 *   getName() {
 *     return 'workflows';
 *   }
 *
 *   registerHandlers(server) {
 *     server.registerMessageHandler('run_workflow', async (session, message) => {
 *       // Handle workflow execution
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
   * @returns Plugin name (e.g., 'workflows', 'analytics', 'auth')
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
   * Optional cleanup hook called when the server is shutting down.
   * Use this to flush pending data, close connections, etc.
   *
   * @returns Promise that resolves when cleanup is complete
   */
  close?(): Promise<void>;
}
