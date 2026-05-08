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
      expect(shouldSubmitOnEnter(evt({ key: 'a' }), true)).toBe(false);
      expect(shouldSubmitOnEnter(evt({ key: 'a' }), false)).toBe(false);
      expect(shouldSubmitOnEnter(evt({ key: 'Escape' }), true)).toBe(false);
    });
  });

  describe('IME composition', () => {
    test('Enter during composition does not submit (desktop mode)', () => {
      expect(
        shouldSubmitOnEnter(evt({ nativeEvent: { isComposing: true } }), true)
      ).toBe(false);
    });

    test('Enter during composition does not submit (mobile mode, even with Cmd)', () => {
      expect(
        shouldSubmitOnEnter(
          evt({ nativeEvent: { isComposing: true }, metaKey: true }),
          false
        )
      ).toBe(false);
    });

    test('Safari IME (keyCode 229) does not submit', () => {
      expect(shouldSubmitOnEnter(evt({ keyCode: 229 }), true)).toBe(false);
      expect(
        shouldSubmitOnEnter(evt({ keyCode: 229, metaKey: true }), false)
      ).toBe(false);
    });
  });

  describe('enterToSend = true (desktop default)', () => {
    test('plain Enter submits', () => {
      expect(shouldSubmitOnEnter(evt(), true)).toBe(true);
    });

    test('Shift+Enter does not submit (newline)', () => {
      expect(shouldSubmitOnEnter(evt({ shiftKey: true }), true)).toBe(false);
    });

    test('Cmd+Enter still submits', () => {
      expect(shouldSubmitOnEnter(evt({ metaKey: true }), true)).toBe(true);
    });
  });

  describe('enterToSend = false (mobile)', () => {
    test('plain Enter does not submit (newline)', () => {
      expect(shouldSubmitOnEnter(evt(), false)).toBe(false);
    });

    test('Shift+Enter does not submit', () => {
      expect(shouldSubmitOnEnter(evt({ shiftKey: true }), false)).toBe(false);
    });

    test('Cmd+Enter submits (physical keyboard escape hatch)', () => {
      expect(shouldSubmitOnEnter(evt({ metaKey: true }), false)).toBe(true);
    });

    test('Ctrl+Enter submits', () => {
      expect(shouldSubmitOnEnter(evt({ ctrlKey: true }), false)).toBe(true);
    });

    test('Cmd+Shift+Enter submits (modifier dominates)', () => {
      expect(
        shouldSubmitOnEnter(evt({ metaKey: true, shiftKey: true }), false)
      ).toBe(true);
    });
  });
});
