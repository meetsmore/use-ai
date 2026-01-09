import { useState, useCallback, useRef, useEffect } from 'react';
import type { CommandRepository, SavedCommand } from '../commands/types';
import { LocalStorageCommandRepository } from '../commands/LocalStorageCommandRepository';

export interface UseCommandManagementOptions {
  /** Custom command repository. Defaults to LocalStorageCommandRepository. */
  repository?: CommandRepository;
}

export interface UseCommandManagementReturn {
  /** List of saved slash commands */
  commands: SavedCommand[];
  /** Refreshes the commands list from storage */
  refreshCommands: () => Promise<void>;
  /** Saves a new command */
  saveCommand: (name: string, text: string) => Promise<string>;
  /** Renames an existing command */
  renameCommand: (id: string, newName: string) => Promise<void>;
  /** Deletes a command by ID */
  deleteCommand: (id: string) => Promise<void>;
}

/**
 * Hook for managing slash commands persistence.
 *
 * Features:
 * - CRUD operations for slash commands
 * - Auto-loads commands on mount
 * - Uses LocalStorageCommandRepository by default
 *
 * @example
 * ```typescript
 * const {
 *   commands,
 *   refreshCommands,
 *   saveCommand,
 *   renameCommand,
 *   deleteCommand,
 * } = useCommandManagement();
 *
 * // Save a new command
 * await saveCommand('greet', 'Hello, how can I help you today?');
 *
 * // Rename a command
 * await renameCommand(commandId, 'greeting');
 *
 * // Delete a command
 * await deleteCommand(commandId);
 * ```
 */
export function useCommandManagement({
  repository,
}: UseCommandManagementOptions = {}): UseCommandManagementReturn {
  const repositoryRef = useRef<CommandRepository>(
    repository || new LocalStorageCommandRepository()
  );

  const [commands, setCommands] = useState<SavedCommand[]>([]);

  const refreshCommands = useCallback(async () => {
    try {
      const cmdList = await repositoryRef.current.listCommands();
      setCommands(cmdList);
      console.log('[CommandManagement] Loaded', cmdList.length, 'commands');
    } catch (err) {
      console.error('[CommandManagement] Failed to load commands:', err);
    }
  }, []);

  const saveCommand = useCallback(async (name: string, text: string): Promise<string> => {
    const id = await repositoryRef.current.createCommand({ name, text });
    await refreshCommands();
    console.log('[CommandManagement] Saved command:', name);
    return id;
  }, [refreshCommands]);

  const renameCommand = useCallback(async (id: string, newName: string): Promise<void> => {
    const command = await repositoryRef.current.loadCommand(id);
    if (!command) throw new Error(`Command ${id} not found`);
    command.name = newName.trim();
    await repositoryRef.current.updateCommand(command);
    await refreshCommands();
    console.log('[CommandManagement] Renamed command:', id, 'to', newName);
  }, [refreshCommands]);

  const deleteCommand = useCallback(async (id: string): Promise<void> => {
    await repositoryRef.current.deleteCommand(id);
    await refreshCommands();
    console.log('[CommandManagement] Deleted command:', id);
  }, [refreshCommands]);

  // Load commands on mount
  useEffect(() => {
    refreshCommands();
  }, [refreshCommands]);

  return {
    commands,
    refreshCommands,
    saveCommand,
    renameCommand,
    deleteCommand,
  };
}
