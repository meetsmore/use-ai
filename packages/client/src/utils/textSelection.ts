/**
 * Helpers for carrying a user's text selection from one DOM subtree to another.
 *
 * The chat renders a streaming answer in a temporary bubble and, once the run
 * finishes, re-renders the same text as a persisted message. Removing the
 * temporary bubble from the document collapses any selection the user made
 * inside it, so a Ctrl/Cmd+C right after generation ends has nothing to copy
 * and leaves the clipboard holding whatever was in it before. Snapshotting the
 * selection as plain text offsets lets it be re-applied to the persisted bubble.
 */

/** A selection expressed as offsets into a container's concatenated text. */
export interface TextSelectionSnapshot {
  /** Offset of the selection start within the container's text. */
  start: number;
  /** Offset of the selection end within the container's text. */
  end: number;
  /** The selected text, used to verify the offsets still point at the same content. */
  text: string;
}

/**
 * Captures the current selection as offsets into `container`.
 *
 * Returns null when there is no selection, when it is collapsed, or when it
 * extends outside `container` (a partially outside selection can't be mapped
 * back onto a different subtree).
 */
export function snapshotSelection(container: HTMLElement): TextSelectionSnapshot | null {
  const selection = container.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }

  // Range.toString() concatenates the text nodes it spans, matching how
  // restoreSelection walks the target container.
  const beforeStart = range.cloneRange();
  beforeStart.selectNodeContents(container);
  beforeStart.setEnd(range.startContainer, range.startOffset);

  const text = range.toString();
  if (!text) return null;

  const start = beforeStart.toString().length;
  return { start, end: start + text.length, text };
}

/**
 * Re-applies a snapshot to `container`.
 *
 * No-op (returns false) when the container's text no longer matches the
 * snapshot, so a mismatch leaves the user's current selection alone rather
 * than selecting the wrong range.
 */
export function restoreSelection(container: HTMLElement, snapshot: TextSelectionSnapshot): boolean {
  const doc = container.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  if (!selection) return false;

  const start = locateOffset(container, snapshot.start);
  const end = locateOffset(container, snapshot.end);
  if (!start || !end) return false;

  const range = doc.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);

  if (range.toString() !== snapshot.text) return false;

  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/** Maps a text offset within `container` onto the text node that contains it. */
function locateOffset(
  container: HTMLElement,
  offset: number
): { node: Text; offset: number } | null {
  const doc = container.ownerDocument;
  const walker = doc.createTreeWalker(container, doc.defaultView?.NodeFilter.SHOW_TEXT ?? 0x4);
  let consumed = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (offset <= consumed + node.data.length) {
      return { node, offset: offset - consumed };
    }
    consumed += node.data.length;
  }

  // Offset past the end of the container's text.
  return null;
}
