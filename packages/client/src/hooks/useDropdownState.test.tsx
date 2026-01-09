import { describe, it, expect } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useDropdownState } from './useDropdownState';

describe('useDropdownState', () => {
  it('should initialize with isOpen=false by default', () => {
    const { result } = renderHook(() => useDropdownState());
    expect(result.current.isOpen).toBe(false);
  });

  it('should initialize with custom initial state', () => {
    const { result } = renderHook(() => useDropdownState({ initialOpen: true }));
    expect(result.current.isOpen).toBe(true);
  });

  it('should open dropdown', () => {
    const { result } = renderHook(() => useDropdownState());

    act(() => {
      result.current.open();
    });

    expect(result.current.isOpen).toBe(true);
  });

  it('should close dropdown', () => {
    const { result } = renderHook(() => useDropdownState({ initialOpen: true }));

    act(() => {
      result.current.close();
    });

    expect(result.current.isOpen).toBe(false);
  });

  it('should toggle dropdown', () => {
    const { result } = renderHook(() => useDropdownState());

    // Toggle open
    act(() => {
      result.current.toggle();
    });
    expect(result.current.isOpen).toBe(true);

    // Toggle closed
    act(() => {
      result.current.toggle();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it('should return null Backdrop when closed', () => {
    const { result } = renderHook(() => useDropdownState());
    expect(result.current.Backdrop).toBe(null);
  });

  it('should return Backdrop element when open', () => {
    const { result } = renderHook(() => useDropdownState({ initialOpen: true }));
    expect(result.current.Backdrop).not.toBe(null);
  });
});
