import React, { useState, useCallback, useMemo } from 'react';

/**
 * Return value from useDropdownState hook.
 */
export interface UseDropdownStateReturn {
  /** Whether the dropdown is currently open */
  isOpen: boolean;
  /** Opens the dropdown */
  open: () => void;
  /** Closes the dropdown */
  close: () => void;
  /** Toggles the dropdown open/closed */
  toggle: () => void;
  /**
   * Backdrop element that closes dropdown when clicked.
   * Render this as a sibling to the dropdown content (both inside a container).
   * Returns null when dropdown is closed.
   */
  Backdrop: React.ReactNode;
}

export interface UseDropdownStateOptions {
  /** z-index for the backdrop (default: 1002) */
  backdropZIndex?: number;
  /** Initial open state (default: false) */
  initialOpen?: boolean;
}

/**
 * Hook for managing dropdown open/close state with click-outside handling.
 *
 * Provides a reusable pattern for dropdowns that:
 * - Track open/close state
 * - Close when clicking outside (via backdrop)
 *
 * @example
 * ```typescript
 * const dropdown = useDropdownState();
 *
 * return (
 *   <div style={{ position: 'relative' }}>
 *     <button onClick={dropdown.toggle}>Toggle</button>
 *
 *     {dropdown.isOpen && (
 *       <div className="dropdown-content">
 *         Dropdown content here
 *       </div>
 *     )}
 *
 *     {dropdown.Backdrop}
 *   </div>
 * );
 * ```
 */
export function useDropdownState(options: UseDropdownStateOptions = {}): UseDropdownStateReturn {
  const { backdropZIndex = 1002, initialOpen = false } = options;

  const [isOpen, setIsOpen] = useState(initialOpen);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const Backdrop = useMemo(() => {
    if (!isOpen) return null;

    return (
      <div
        onClick={close}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: backdropZIndex,
        }}
      />
    );
  }, [isOpen, close, backdropZIndex]);

  return {
    isOpen,
    open,
    close,
    toggle,
    Backdrop,
  };
}
