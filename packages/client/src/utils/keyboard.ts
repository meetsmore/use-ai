/**
 * How the chat textarea should treat the Enter key.
 *
 * - `'enter'`     — Enter submits the message, Shift+Enter inserts a newline.
 *                   Typical desktop behavior.
 * - `'mod-enter'` — Enter inserts a newline. Cmd/Ctrl+Enter submits the message.
 *                   Recommended on mobile, where soft keyboards lack modifier
 *                   keys and the user is expected to tap the send button.
 *                   ("mod" follows the CodeMirror/ProseMirror convention of
 *                   meaning Cmd on macOS and Ctrl elsewhere.)
 */
export type SubmitMode = 'enter' | 'mod-enter';

/**
 * Subset of `React.KeyboardEvent` consumed by `shouldSubmitOnEnter`.
 * Kept structural so the helper can be unit-tested without a React event.
 */
export interface SubmitKeyEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  keyCode: number;
  nativeEvent: { isComposing: boolean };
}

/**
 * Decide whether a keydown event in the chat textarea should submit the message.
 *
 * IME composition (Japanese, Korean, Chinese, etc.) never submits. Safari
 * reports `isComposing === false` when pressing Enter to confirm an IME input,
 * so we additionally check `keyCode === 229` as a Safari-specific fallback.
 * Reference: https://zenn.dev/spacemarket/articles/149aa284ef7b08
 */
export function shouldSubmitOnEnter(e: SubmitKeyEvent, mode: SubmitMode): boolean {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) {
    return false;
  }
  if (mode === 'enter') {
    return !e.shiftKey;
  }
  // 'mod-enter'
  return e.metaKey || e.ctrlKey;
}
