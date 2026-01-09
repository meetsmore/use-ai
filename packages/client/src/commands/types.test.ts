import { describe, expect, it } from 'bun:test';
import { validateCommandName, generateCommandId } from './types';

describe('validateCommandName', () => {
  it('accepts valid kebab-case names', () => {
    expect(validateCommandName('my-command')).toBeNull();
    expect(validateCommandName('command123')).toBeNull();
    expect(validateCommandName('test')).toBeNull();
    expect(validateCommandName('a-b-c')).toBeNull();
  });

  it('rejects empty names', () => {
    expect(validateCommandName('')).toBe('Command name is required');
    expect(validateCommandName('   ')).toBe('Command name is required');
  });

  it('rejects uppercase letters', () => {
    expect(validateCommandName('MyCommand')).toBe(
      'Only lowercase letters, numbers, and hyphens allowed (kebab-case)'
    );
    expect(validateCommandName('COMMAND')).toBe(
      'Only lowercase letters, numbers, and hyphens allowed (kebab-case)'
    );
  });

  it('rejects invalid characters', () => {
    expect(validateCommandName('my command')).toBe(
      'Only lowercase letters, numbers, and hyphens allowed (kebab-case)'
    );
    expect(validateCommandName('my_command')).toBe(
      'Only lowercase letters, numbers, and hyphens allowed (kebab-case)'
    );
    expect(validateCommandName('my@command')).toBe(
      'Only lowercase letters, numbers, and hyphens allowed (kebab-case)'
    );
  });

  it('rejects names that are too long', () => {
    const longName = 'a'.repeat(51);
    expect(validateCommandName(longName)).toBe('Command name must be 50 characters or less');
  });
});

describe('generateCommandId', () => {
  it('generates unique IDs', () => {
    const id1 = generateCommandId();
    const id2 = generateCommandId();
    expect(id1).not.toBe(id2);
  });

  it('starts with cmd_ prefix', () => {
    const id = generateCommandId();
    expect(id.startsWith('cmd_')).toBe(true);
  });
});
