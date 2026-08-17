import { useEffect, useLayoutEffect, useRef } from 'react';
import { snapshotSelection, restoreSelection, type TextSelectionSnapshot } from '../utils/textSelection';

export interface UseSelectionHandoffOptions {
  /** Whether a run is in flight (the streaming bubble is mounted). */
  loading: boolean;
  /** The element wrapping the streaming answer's rendered markdown. */
  streamingRef: React.RefObject<HTMLElement | null>;
  /** The element wrapping the persisted answer that replaces it. */
  persistedRef: React.RefObject<HTMLElement | null>;
}

/**
 * Keeps a selection made inside the streaming bubble alive when the run ends.
 *
 * When a run finishes the streaming bubble is unmounted and the same text is
 * re-rendered as a persisted message, which collapses the user's selection and
 * clears the highlight. Ctrl/Cmd+C then has nothing to copy and silently leaves
 * the clipboard untouched, so the user pastes whatever they copied last. This
 * snapshots the selection while streaming and re-applies it to the persisted
 * bubble in the same frame it appears.
 */
export function useSelectionHandoff({ loading, streamingRef, persistedRef }: UseSelectionHandoffOptions): void {
  const snapshotRef = useRef<TextSelectionSnapshot | null>(null);
  const persistedAtSnapshotRef = useRef<HTMLElement | null>(null);
  const wasLoadingRef = useRef(loading);

  useEffect(() => {
    if (!loading) return;

    const element = streamingRef.current;
    const doc = element?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (!doc) return;

    const handleSelectionChange = () => {
      const streaming = streamingRef.current;
      snapshotRef.current = streaming ? snapshotSelection(streaming) : null;
      persistedAtSnapshotRef.current = persistedRef.current;
    };

    doc.addEventListener('selectionchange', handleSelectionChange);
    return () => doc.removeEventListener('selectionchange', handleSelectionChange);
  }, [loading, streamingRef, persistedRef]);

  useLayoutEffect(() => {
    const justFinished = wasLoadingRef.current && !loading;
    wasLoadingRef.current = loading;
    if (!justFinished) return;

    const snapshot = snapshotRef.current;
    const persisted = persistedRef.current;
    const persistedAtSnapshot = persistedAtSnapshotRef.current;
    snapshotRef.current = null;
    persistedAtSnapshotRef.current = null;
    if (!snapshot || !persisted) return;

    // A run can end without producing an answer (transport error, disconnect),
    // and then the last answer on screen is still the previous turn's. Its text
    // can coincidentally match the snapshot, so without this the selection
    // would jump to text the user never highlighted.
    if (persisted === persistedAtSnapshot) return;

    restoreSelection(persisted, snapshot);
  }, [loading, persistedRef]);
}
