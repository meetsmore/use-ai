import { describe, expect, it, beforeEach } from 'bun:test';
import { LocalStorageCommandRepository } from './LocalStorageCommandRepository';

// Mock localStorage
class MockStorage implements Storage {
  private data: Map<string, string> = new Map();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    const keys = Array.from(this.data.keys());
    return keys[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('LocalStorageCommandRepository', () => {
  let storage: MockStorage;
  let repository: LocalStorageCommandRepository;

  beforeEach(() => {
    storage = new MockStorage();
    repository = new LocalStorageCommandRepository(storage);
  });

  describe('createCommand', () => {
    it('creates a command and returns ID', async () => {
      const id = await repository.createCommand({
        name: 'greet',
        text: 'Hello there!',
      });

      expect(id).toMatch(/^cmd_/);
    });

    it('trims whitespace from command names', async () => {
      await repository.createCommand({
        name: '  my-command  ',
        text: 'test',
      });

      const command = await repository.loadCommandByName('my-command');
      expect(command?.name).toBe('my-command');
    });

    it('throws on duplicate name', async () => {
      await repository.createCommand({ name: 'test', text: 'a' });

      await expect(
        repository.createCommand({ name: 'test', text: 'b' })
      ).rejects.toThrow('Command "test" already exists');
    });
  });

  describe('loadCommand', () => {
    it('loads a saved command', async () => {
      const id = await repository.createCommand({
        name: 'greet',
        text: 'Hello there!',
      });

      const command = await repository.loadCommand(id);
      expect(command).not.toBeNull();
      expect(command?.name).toBe('greet');
      expect(command?.text).toBe('Hello there!');
      expect(command?.createdAt).toBeInstanceOf(Date);
    });

    it('returns null for non-existent command', async () => {
      const command = await repository.loadCommand('non-existent');
      expect(command).toBeNull();
    });
  });

  describe('loadCommandByName', () => {
    it('finds command by name', async () => {
      await repository.createCommand({
        name: 'greet',
        text: 'Hello!',
      });

      const command = await repository.loadCommandByName('greet');
      expect(command?.name).toBe('greet');
    });

    it('trims whitespace when searching by name', async () => {
      await repository.createCommand({
        name: 'greet',
        text: 'Hello!',
      });

      const command = await repository.loadCommandByName('  greet  ');
      expect(command?.name).toBe('greet');
    });

    it('returns null when not found', async () => {
      const command = await repository.loadCommandByName('non-existent');
      expect(command).toBeNull();
    });
  });

  describe('updateCommand', () => {
    it('updates command data', async () => {
      const id = await repository.createCommand({
        name: 'test',
        text: 'original',
      });

      const command = await repository.loadCommand(id);
      command!.text = 'updated text';
      command!.lastUsedAt = new Date();
      await repository.updateCommand(command!);

      const updated = await repository.loadCommand(id);
      expect(updated?.text).toBe('updated text');
      expect(updated?.lastUsedAt).toBeInstanceOf(Date);
    });
  });

  describe('deleteCommand', () => {
    it('removes command', async () => {
      const id = await repository.createCommand({
        name: 'test',
        text: 'Hello',
      });

      await repository.deleteCommand(id);

      const command = await repository.loadCommand(id);
      expect(command).toBeNull();
    });

    it('removes from index', async () => {
      const id = await repository.createCommand({
        name: 'test',
        text: 'Hello',
      });

      await repository.deleteCommand(id);

      const commands = await repository.listCommands();
      expect(commands).toHaveLength(0);
    });
  });

  describe('listCommands', () => {
    it('lists all commands', async () => {
      await repository.createCommand({ name: 'cmd1', text: 'a' });
      await repository.createCommand({ name: 'cmd2', text: 'b' });
      await repository.createCommand({ name: 'cmd3', text: 'c' });

      const commands = await repository.listCommands();
      expect(commands).toHaveLength(3);
    });

    it('filters by prefix', async () => {
      await repository.createCommand({ name: 'greet-user', text: 'a' });
      await repository.createCommand({ name: 'greet-admin', text: 'b' });
      await repository.createCommand({ name: 'other', text: 'c' });

      const commands = await repository.listCommands({ namePrefix: 'greet' });
      expect(commands).toHaveLength(2);
      expect(commands.map(c => c.name)).toContain('greet-user');
      expect(commands.map(c => c.name)).toContain('greet-admin');
    });

    it('limits results', async () => {
      await repository.createCommand({ name: 'cmd1', text: 'a' });
      await repository.createCommand({ name: 'cmd2', text: 'b' });
      await repository.createCommand({ name: 'cmd3', text: 'c' });

      const commands = await repository.listCommands({ limit: 2 });
      expect(commands).toHaveLength(2);
    });

    it('sorts by lastUsedAt then by name', async () => {
      const id1 = await repository.createCommand({ name: 'zebra', text: 'a' });
      await repository.createCommand({ name: 'apple', text: 'b' });
      await repository.createCommand({ name: 'banana', text: 'c' });

      // Update lastUsedAt for zebra
      const cmd = await repository.loadCommand(id1);
      cmd!.lastUsedAt = new Date();
      await repository.updateCommand(cmd!);

      const commands = await repository.listCommands();
      // zebra should be first (has lastUsedAt)
      expect(commands[0].name).toBe('zebra');
      // then alphabetically: apple, banana
      expect(commands[1].name).toBe('apple');
      expect(commands[2].name).toBe('banana');
    });
  });

  describe('deleteAll', () => {
    it('removes all commands', async () => {
      await repository.createCommand({ name: 'cmd1', text: 'a' });
      await repository.createCommand({ name: 'cmd2', text: 'b' });

      await repository.deleteAll();

      const commands = await repository.listCommands();
      expect(commands).toHaveLength(0);
    });
  });

  describe('max commands limit', () => {
    it('enforces max commands by deleting oldest', async () => {
      const repo = new LocalStorageCommandRepository(storage, 3);

      await repo.createCommand({ name: 'cmd1', text: 'a' });
      await new Promise(r => setTimeout(r, 10)); // Ensure different createdAt
      await repo.createCommand({ name: 'cmd2', text: 'b' });
      await new Promise(r => setTimeout(r, 10));
      await repo.createCommand({ name: 'cmd3', text: 'c' });
      await new Promise(r => setTimeout(r, 10));
      await repo.createCommand({ name: 'cmd4', text: 'd' });

      const commands = await repo.listCommands();
      expect(commands).toHaveLength(3);
      // cmd1 (oldest) should be deleted
      expect(commands.map(c => c.name)).not.toContain('cmd1');
    });
  });
});
