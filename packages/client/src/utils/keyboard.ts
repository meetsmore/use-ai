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
 * - During IME composition (Japanese/Korean/etc.), Enter must never submit.
 *   Safari reports `isComposing === false` when pressing Enter to confirm an
 *   IME input, so we additionally check `keyCode === 229`.
 *   Reference: https://zenn.dev/spacemarket/articles/149aa284ef7b08
 * - When `enterToSend` is `true`, plain Enter submits and Shift+Enter inserts a newline.
 * - When `enterToSend` is `false`, plain Enter inserts a newline; only Cmd/Ctrl+Enter
 *   submits (so users on physical keyboards still have a shortcut).
 */
export function shouldSubmitOnEnter(e: SubmitKeyEvent, enterToSend: boolean): boolean {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) {
    return false;
  }
  if (enterToSend) {
    return !e.shiftKey;
  }
  return e.metaKey || e.ctrlKey;
}
