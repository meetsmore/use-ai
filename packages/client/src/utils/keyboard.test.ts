import { describe, test, expect } from 'bun:test';
import { shouldSubmitOnEnter, type SubmitKeyEvent } from './keyboard';

function evt(overrides: Partial<SubmitKeyEvent> = {}): SubmitKeyEvent {
  return {
    key: 'Enter',
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    keyCode: 0,
    nativeEvent: { isComposing: false },
    ...overrides,
  };
}

describe('shouldSubmitOnEnter', () => {
  describe('non-Enter keys', () => {
    test('returns false for any non-Enter key regardless of mode', () => {
      expect(shouldSubmitOnEnter(evt({ key: 'a' }), 'enter')).toBe(false);
      expect(shouldSubmitOnEnter(evt({ key: 'a' }), 'mod-enter')).toBe(false);
      expect(shouldSubmitOnEnter(evt({ key: 'Escape' }), 'enter')).toBe(false);
    });
  });

  describe('IME composition', () => {
    test('Enter during composition does not submit (mode=enter)', () => {
      expect(
        shouldSubmitOnEnter(evt({ nativeEvent: { isComposing: true } }), 'enter')
      ).toBe(false);
    });

    test('Cmd+Enter during composition does not submit (mode=mod-enter)', () => {
      expect(
        shouldSubmitOnEnter(
          evt({ nativeEvent: { isComposing: true }, metaKey: true }),
          'mod-enter'
        )
      ).toBe(false);
    });

    test('Safari IME (keyCode 229) does not submit', () => {
      expect(shouldSubmitOnEnter(evt({ keyCode: 229 }), 'enter')).toBe(false);
      expect(
        shouldSubmitOnEnter(evt({ keyCode: 229, metaKey: true }), 'mod-enter')
      ).toBe(false);
    });
  });

  describe("mode = 'enter' (desktop default)", () => {
    test('plain Enter submits', () => {
      expect(shouldSubmitOnEnter(evt(), 'enter')).toBe(true);
    });

    test('Shift+Enter does not submit (newline)', () => {
      expect(shouldSubmitOnEnter(evt({ shiftKey: true }), 'enter')).toBe(false);
    });

    test('Cmd+Enter still submits', () => {
      expect(shouldSubmitOnEnter(evt({ metaKey: true }), 'enter')).toBe(true);
    });
  });

  describe("mode = 'mod-enter' (mobile)", () => {
    test('plain Enter does not submit (newline)', () => {
      expect(shouldSubmitOnEnter(evt(), 'mod-enter')).toBe(false);
    });

    test('Shift+Enter does not submit', () => {
      expect(shouldSubmitOnEnter(evt({ shiftKey: true }), 'mod-enter')).toBe(false);
    });

    test('Cmd+Enter submits (physical keyboard escape hatch)', () => {
      expect(shouldSubmitOnEnter(evt({ metaKey: true }), 'mod-enter')).toBe(true);
    });

    test('Ctrl+Enter submits', () => {
      expect(shouldSubmitOnEnter(evt({ ctrlKey: true }), 'mod-enter')).toBe(true);
    });

    test('Cmd+Shift+Enter submits (modifier dominates)', () => {
      expect(
        shouldSubmitOnEnter(evt({ metaKey: true, shiftKey: true }), 'mod-enter')
      ).toBe(true);
    });
  });
});
