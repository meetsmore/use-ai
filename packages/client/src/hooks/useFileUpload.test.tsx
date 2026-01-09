import { renderHook, act } from '@testing-library/react';
import { useFileUpload } from './useFileUpload';

describe('useFileUpload', () => {
  describe('when disabled', () => {
    it('returns enabled: false when config is undefined', () => {
      const { result } = renderHook(() => useFileUpload({}));
      expect(result.current.enabled).toBe(false);
    });

    it('ignores drag events when disabled', () => {
      const { result } = renderHook(() => useFileUpload({}));

      const mockEvent = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      } as unknown as React.DragEvent;

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(result.current.isDragging).toBe(false);
    });
  });

  describe('when enabled', () => {
    const config = {
      backend: { prepareForSend: async (file: File) => `data:${file.type};base64,test` },
      maxFileSize: 10 * 1024 * 1024,
      acceptedTypes: ['image/*', 'application/pdf'],
    };

    it('returns enabled: true when config is provided', () => {
      const { result } = renderHook(() => useFileUpload({ config }));
      expect(result.current.enabled).toBe(true);
    });

    it('returns correct maxFileSize and acceptedTypes', () => {
      const { result } = renderHook(() => useFileUpload({ config }));
      expect(result.current.maxFileSize).toBe(10 * 1024 * 1024);
      expect(result.current.acceptedTypes).toEqual(['image/*', 'application/pdf']);
    });

    it('starts with empty attachments', () => {
      const { result } = renderHook(() => useFileUpload({ config }));
      expect(result.current.attachments).toEqual([]);
    });

    it('starts with no file error', () => {
      const { result } = renderHook(() => useFileUpload({ config }));
      expect(result.current.fileError).toBeNull();
    });

    it('sets isDragging on dragenter', () => {
      const { result } = renderHook(() => useFileUpload({ config }));

      const mockEvent = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      } as unknown as React.DragEvent;

      act(() => {
        result.current.handleDragEnter(mockEvent);
      });

      expect(result.current.isDragging).toBe(true);
    });

    it('clears isDragging on dragleave when counter reaches zero', () => {
      const { result } = renderHook(() => useFileUpload({ config }));

      const mockEvent = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      } as unknown as React.DragEvent;

      // Enter once
      act(() => {
        result.current.handleDragEnter(mockEvent);
      });
      expect(result.current.isDragging).toBe(true);

      // Leave once - counter goes to 0
      act(() => {
        result.current.handleDragLeave(mockEvent);
      });
      expect(result.current.isDragging).toBe(false);
    });

    it('handles nested drag events without flickering', () => {
      const { result } = renderHook(() => useFileUpload({ config }));

      const mockEvent = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      } as unknown as React.DragEvent;

      // Enter parent
      act(() => {
        result.current.handleDragEnter(mockEvent);
      });
      expect(result.current.isDragging).toBe(true);

      // Enter child (counter = 2)
      act(() => {
        result.current.handleDragEnter(mockEvent);
      });
      expect(result.current.isDragging).toBe(true);

      // Leave child (counter = 1, still dragging)
      act(() => {
        result.current.handleDragLeave(mockEvent);
      });
      expect(result.current.isDragging).toBe(true);

      // Leave parent (counter = 0)
      act(() => {
        result.current.handleDragLeave(mockEvent);
      });
      expect(result.current.isDragging).toBe(false);
    });

    it('does not set isDragging when disabled prop is true', () => {
      const { result } = renderHook(() => useFileUpload({ config, disabled: true }));

      const mockEvent = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      } as unknown as React.DragEvent;

      act(() => {
        result.current.handleDragEnter(mockEvent);
      });

      expect(result.current.isDragging).toBe(false);
    });

    it('adds valid files to attachments', async () => {
      const { result } = renderHook(() => useFileUpload({ config }));

      // Use PDF to avoid FileReader (not available in test env)
      const mockFile = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      await act(async () => {
        await result.current.handleFiles([mockFile]);
      });

      expect(result.current.attachments).toHaveLength(1);
      expect(result.current.attachments[0].file).toBe(mockFile);
    });

    it('rejects files that exceed maxFileSize', async () => {
      const smallConfig = { ...config, maxFileSize: 10 };
      const { result } = renderHook(() => useFileUpload({ config: smallConfig }));

      const mockFile = new File(['test content that is too large'], 'test.png', { type: 'image/png' });

      await act(async () => {
        await result.current.handleFiles([mockFile]);
      });

      expect(result.current.attachments).toHaveLength(0);
      expect(result.current.fileError).toContain('exceeds');
    });

    it('rejects files with unaccepted types', async () => {
      const { result } = renderHook(() => useFileUpload({ config }));

      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });

      await act(async () => {
        await result.current.handleFiles([mockFile]);
      });

      expect(result.current.attachments).toHaveLength(0);
      expect(result.current.fileError).toContain('not accepted');
    });

    it('removes attachment by id', async () => {
      const { result } = renderHook(() => useFileUpload({ config }));

      // Use PDF to avoid FileReader (not available in test env)
      const mockFile = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      await act(async () => {
        await result.current.handleFiles([mockFile]);
      });

      const attachmentId = result.current.attachments[0].id;

      act(() => {
        result.current.removeAttachment(attachmentId);
      });

      expect(result.current.attachments).toHaveLength(0);
    });

    it('clears all attachments', async () => {
      const { result } = renderHook(() => useFileUpload({ config }));

      // Use PDF to avoid FileReader (not available in test env)
      const mockFile1 = new File(['test1'], 'test1.pdf', { type: 'application/pdf' });
      const mockFile2 = new File(['test2'], 'test2.pdf', { type: 'application/pdf' });

      await act(async () => {
        await result.current.handleFiles([mockFile1, mockFile2]);
      });

      expect(result.current.attachments).toHaveLength(2);

      act(() => {
        result.current.clearAttachments();
      });

      expect(result.current.attachments).toHaveLength(0);
    });

    it('clears attachments when resetDependency changes', async () => {
      const { result, rerender } = renderHook(
        ({ dep }) => useFileUpload({ config, resetDependency: dep }),
        { initialProps: { dep: 'chat-1' } }
      );

      // Use PDF to avoid FileReader (not available in test env)
      const mockFile = new File(['test'], 'test.pdf', { type: 'application/pdf' });

      await act(async () => {
        await result.current.handleFiles([mockFile]);
      });

      expect(result.current.attachments).toHaveLength(1);

      // Change resetDependency
      rerender({ dep: 'chat-2' });

      expect(result.current.attachments).toHaveLength(0);
    });
  });
});
