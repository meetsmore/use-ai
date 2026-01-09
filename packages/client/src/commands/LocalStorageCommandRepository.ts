import type {
  CommandRepository,
  SavedCommand,
  CreateCommandOptions,
  ListCommandsOptions,
} from './types';
import { generateCommandId } from './types';

const STORAGE_KEY_PREFIX = 'use-ai:command:';
const STORAGE_INDEX_KEY = 'use-ai:command-index';
const DEFAULT_MAX_COMMANDS = 50;

/**
 * LocalStorage-based implementation of CommandRepository.
 * Stores commands in browser localStorage with an index for efficient listing.
 */
export class LocalStorageCommandRepository implements CommandRepository {
  private storage: Storage;
  private maxCommands: number;

  constructor(storage: Storage = localStorage, maxCommands: number = DEFAULT_MAX_COMMANDS) {
    this.storage = storage;
    this.maxCommands = maxCommands;
  }

  async createCommand(options: CreateCommandOptions): Promise<string> {
    const name = options.name.trim();

    // Check for duplicate name
    const existing = await this.loadCommandByName(name);
    if (existing) {
      throw new Error(`Command "${name}" already exists`);
    }

    const id = generateCommandId();
    const command: SavedCommand = {
      id,
      name,
      text: options.text,
      createdAt: new Date(),
    };

    await this.enforceMaxCommandsLimit();
    this.saveCommandToStorage(command);
    await this.addToIndex(id);
    return id;
  }

  async loadCommand(id: string): Promise<SavedCommand | null> {
    try {
      const data = this.storage.getItem(`${STORAGE_KEY_PREFIX}${id}`);
      if (!data) return null;
      return this.deserializeCommand(data);
    } catch {
      return null;
    }
  }

  async loadCommandByName(name: string): Promise<SavedCommand | null> {
    const trimmedName = name.trim();
    const commands = await this.listCommands();
    return commands.find(c => c.name === trimmedName) || null;
  }

  async updateCommand(command: SavedCommand): Promise<void> {
    this.saveCommandToStorage(command);
  }

  async deleteCommand(id: string): Promise<void> {
    this.storage.removeItem(`${STORAGE_KEY_PREFIX}${id}`);
    await this.removeFromIndex(id);
  }

  async listCommands(options?: ListCommandsOptions): Promise<SavedCommand[]> {
    const ids = this.getIndex();
    const commands: SavedCommand[] = [];

    for (const id of ids) {
      const cmd = await this.loadCommand(id);
      if (cmd) {
        // Filter by prefix if specified
        if (!options?.namePrefix || cmd.name.startsWith(options.namePrefix.toLowerCase())) {
          commands.push(cmd);
        }
      }
    }

    // Sort by lastUsedAt (most recent first), then by name
    commands.sort((a, b) => {
      if (a.lastUsedAt && b.lastUsedAt) {
        return b.lastUsedAt.getTime() - a.lastUsedAt.getTime();
      }
      if (a.lastUsedAt) return -1;
      if (b.lastUsedAt) return 1;
      return a.name.localeCompare(b.name);
    });

    return options?.limit ? commands.slice(0, options.limit) : commands;
  }

  async deleteAll(): Promise<void> {
    const ids = this.getIndex();
    for (const id of ids) {
      this.storage.removeItem(`${STORAGE_KEY_PREFIX}${id}`);
    }
    this.storage.removeItem(STORAGE_INDEX_KEY);
  }

  private saveCommandToStorage(command: SavedCommand): void {
    this.storage.setItem(
      `${STORAGE_KEY_PREFIX}${command.id}`,
      JSON.stringify(command)
    );
  }

  private deserializeCommand(data: string): SavedCommand {
    const parsed = JSON.parse(data) as SavedCommand;
    // Convert date strings back to Date objects
    parsed.createdAt = new Date(parsed.createdAt);
    if (parsed.lastUsedAt) {
      parsed.lastUsedAt = new Date(parsed.lastUsedAt);
    }
    return parsed;
  }

  private getIndex(): string[] {
    const data = this.storage.getItem(STORAGE_INDEX_KEY);
    return data ? JSON.parse(data) : [];
  }

  private async addToIndex(id: string): Promise<void> {
    const index = this.getIndex();
    if (!index.includes(id)) {
      index.push(id);
      this.storage.setItem(STORAGE_INDEX_KEY, JSON.stringify(index));
    }
  }

  private async removeFromIndex(id: string): Promise<void> {
    const index = this.getIndex();
    this.storage.setItem(
      STORAGE_INDEX_KEY,
      JSON.stringify(index.filter(i => i !== id))
    );
  }

  private async enforceMaxCommandsLimit(): Promise<void> {
    const commands = await this.listCommands();
    if (commands.length >= this.maxCommands) {
      // Sort by createdAt to find oldest
      const sorted = [...commands].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      );
      const numToDelete = commands.length - this.maxCommands + 1;
      for (let i = 0; i < numToDelete; i++) {
        await this.deleteCommand(sorted[i].id);
      }
    }
  }
}
