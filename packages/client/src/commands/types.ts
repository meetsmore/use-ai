/**
 * A saved slash command.
 */
export interface SavedCommand {
  /** Unique identifier */
  id: string;
  /** Command name (without the leading slash) */
  name: string;
  /** The saved text */
  text: string;
  /** When the command was created */
  createdAt: Date;
  /** When the command was last used */
  lastUsedAt?: Date;
}

/**
 * Options for creating a command.
 */
export interface CreateCommandOptions {
  name: string;
  text: string;
}

/**
 * Options for listing commands.
 */
export interface ListCommandsOptions {
  /** Filter commands by name prefix */
  namePrefix?: string;
  /** Limit number of results */
  limit?: number;
}

/**
 * Abstract repository interface for command persistence.
 */
export interface CommandRepository {
  createCommand(options: CreateCommandOptions): Promise<string>;
  loadCommand(id: string): Promise<SavedCommand | null>;
  loadCommandByName(name: string): Promise<SavedCommand | null>;
  updateCommand(command: SavedCommand): Promise<void>;
  deleteCommand(id: string): Promise<void>;
  listCommands(options?: ListCommandsOptions): Promise<SavedCommand[]>;
  deleteAll(): Promise<void>;
}

/**
 * Generates a unique command ID.
 */
export function generateCommandId(): string {
  return `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Validates a command name.
 * Commands must be kebab-case: lowercase letters, numbers, and hyphens only.
 * Returns null if valid, or an error message if invalid.
 */
export function validateCommandName(name: string): string | null {
  if (!name.trim()) {
    return 'Command name is required';
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    return 'Only lowercase letters, numbers, and hyphens allowed (kebab-case)';
  }
  if (name.length > 50) {
    return 'Command name must be 50 characters or less';
  }
  return null;
}
