import { describe, it, expect, mock } from 'bun:test';
import { renderHook, act } from '@testing-library/react';
import { useServerEvents } from './useServerEvents';
import { defaultStrings } from '../theme/strings';
import { ErrorCode } from '../types';
import { makeToolSystem } from '../../test/toolSystemMock';

describe('useServerEvents.handleDisconnect', () => {
  it('is a no-op when no run is in flight', () => {
    const saveAIResponse = mock(async () => {});
    const { result } = renderHook(() =>
      useServerEvents({
        toolSystem: makeToolSystem(),
        saveAIResponse,
        strings: defaultStrings,
      }),
    );

    expect(result.current.loading).toBe(false);

    act(() => {
      result.current.handleDisconnect();
    });

    expect(result.current.loading).toBe(false);
    expect(saveAIResponse).not.toHaveBeenCalled();
  });

  it('clears loading and writes an error message when a run was in flight', () => {
    const saveAIResponse = mock(async () => {});
    const { result } = renderHook(() =>
      useServerEvents({
        toolSystem: makeToolSystem(),
        saveAIResponse,
        strings: defaultStrings,
      }),
    );

    // Simulate a send() having marked the run as loading.
    act(() => {
      result.current.setLoading(true);
    });
    expect(result.current.loading).toBe(true);

    act(() => {
      result.current.handleDisconnect();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.executingTool).toBeNull();
    expect(saveAIResponse).toHaveBeenCalledTimes(1);
    const [message, mode] = saveAIResponse.mock.calls[0];
    expect(message).toBe(defaultStrings.errors[ErrorCode.CONNECTION_LOST]);
    expect(mode).toBe('error');
  });
});
