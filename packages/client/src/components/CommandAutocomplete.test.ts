import { describe, it, expect } from 'bun:test';
import { filterCommands } from './CommandAutocomplete';
import type { SavedCommand } from '../commands/types';

const command = (name: string): SavedCommand => ({ id: name, name, text: name, createdAt: new Date(0) });

describe('filterCommands', () => {
  it('keeps the commands whose name starts with the prefix, ignoring case', () => {
    const commands = [command('Review'), command('rewrite'), command('summary')];

    expect(filterCommands(commands, 'RE').map(c => c.name)).toEqual(['Review', 'rewrite']);
  });

  it('returns all commands for an empty prefix', () => {
    const commands = [command('a'), command('b')];

    expect(filterCommands(commands, '')).toEqual(commands);
  });

  it('returns at most 8 commands', () => {
    const commands = Array.from({ length: 10 }, (_, i) => command(`cmd${i}`));

    expect(filterCommands(commands, 'cmd').map(c => c.name)).toEqual(
      ['cmd0', 'cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6', 'cmd7'],
    );
  });
});
