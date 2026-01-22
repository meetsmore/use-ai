import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { FileAttachment, FileUploadConfig, FileProcessingState, FileTransformer } from '../fileUpload/types';
import { DEFAULT_MAX_FILE_SIZE } from '../fileUpload/types';
import { findTransformer } from '../fileUpload/mimeTypeMatcher';
import { getTransformedContent } from '../fileUpload/processAttachments';
import { v4 as uuidv4 } from 'uuid';
import { useTheme, useStrings } from '../theme';

/**
 * Props for the drop zone container element.
 */
export interface DropZoneProps {
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

/**
 * Generates a preview for image files.
 */
async function generateImagePreview(file: File): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) {
    return undefined;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        resolve(undefined);
      }
    };
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}

/**
 * Checks if a MIME type matches accepted types.
 */
function isTypeAccepted(mimeType: string, acceptedTypes?: string[]): boolean {
  if (!acceptedTypes || acceptedTypes.length === 0) {
    return true;
  }

  return acceptedTypes.some(pattern => {
    if (pattern.endsWith('/*')) {
      // Wildcard pattern like 'image/*'
      const prefix = pattern.slice(0, -1);
      return mimeType.startsWith(prefix);
    }
    return mimeType === pattern;
  });
}

export interface UseFileUploadOptions {
  /** Configuration for file uploads. If undefined, file upload is disabled. */
  config?: FileUploadConfig;
  /** Whether file operations should be disabled (e.g., during loading) */
  disabled?: boolean;
  /** Dependency that resets attachments when changed (e.g., currentChatId) */
  resetDependency?: unknown;
}

export interface UseFileUploadReturn {
  /** Current file attachments */
  attachments: FileAttachment[];
  /** Whether a drag operation is in progress over the drop zone */
  isDragging: boolean;
  /** Current file error message, if any */
  fileError: string | null;
  /** Whether file upload is enabled */
  enabled: boolean;
  /** Maximum file size in bytes */
  maxFileSize: number;
  /** Accepted MIME types */
  acceptedTypes?: string[];
  /** Processing state for each file (by attachment ID) */
  processingState: Map<string, FileProcessingState>;
  /** Ref to attach to hidden file input */
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  /** Validates and adds files to attachments */
  handleFiles: (files: FileList | File[]) => Promise<void>;
  /** Removes a file attachment by ID */
  removeAttachment: (id: string) => void;
  /** Clears all attachments */
  clearAttachments: () => void;
  /** Opens the file picker dialog */
  openFilePicker: () => void;
  /** Handler for file input change event */
  handleFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Handler for dragenter event (use with dragover/dragleave/drop) */
  handleDragEnter: (e: React.DragEvent) => void;
  /** Handler for dragover event */
  handleDragOver: (e: React.DragEvent) => void;
  /** Handler for dragleave event */
  handleDragLeave: (e: React.DragEvent) => void;
  /** Handler for drop event */
  handleDrop: (e: React.DragEvent) => void;
  /** Props to spread on the drop zone container element */
  getDropZoneProps: () => DropZoneProps;
  /** Overlay component to render inside the drop zone container (shows when dragging) */
  DropZoneOverlay: React.ReactNode;
}

/**
 * Hook for managing file uploads with drag-and-drop support.
 *
 * Features:
 * - File validation (size, type)
 * - Image preview generation
 * - Drag and drop handling
 * - Auto-clearing error messages
 * - Reset on dependency change (e.g., chat switch)
 *
 * @example
 * ```typescript
 * const {
 *   attachments,
 *   isDragging,
 *   fileError,
 *   fileInputRef,
 *   handleDragOver,
 *   handleDragLeave,
 *   handleDrop,
 *   openFilePicker,
 *   handleFileInputChange,
 *   removeAttachment,
 * } = useFileUpload({
 *   config: fileUploadConfig,
 *   disabled: loading,
 *   resetDependency: currentChatId,
 * });
 * ```
 */
export function useFileUpload({
  config,
  disabled = false,
  resetDependency,
}: UseFileUploadOptions): UseFileUploadReturn {
  const strings = useStrings();
  const theme = useTheme();

  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [processingState, setProcessingState] = useState<Map<string, FileProcessingState>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Counter to track nested drag enter/leave events (prevents flickering)
  const dragCounterRef = useRef(0);

  const enabled = config !== undefined;
  const maxFileSize = config?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const acceptedTypes = config?.acceptedTypes;
  const transformers = config?.transformers;

  // Clear file error after 3 seconds
  useEffect(() => {
    if (fileError) {
      const timer = setTimeout(() => setFileError(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [fileError]);

  // Clear attachments when resetDependency changes
  useEffect(() => {
    setAttachments([]);
    setFileError(null);
    setProcessingState(new Map());
  }, [resetDependency]);

  /**
   * Runs a transformer for a file attachment.
   * Updates processing state and attachment with transformed content.
   * Uses centralized cache to avoid re-transforming the same file.
   */
  const runTransformer = useCallback(async (
    attachmentId: string,
    file: File,
    transformer: FileTransformer
  ) => {
    // Set initial processing state
    setProcessingState(prev => new Map(prev).set(attachmentId, { status: 'processing' }));

    try {
      const transformedContent = await getTransformedContent(file, transformer, (progress) => {
        setProcessingState(prev => new Map(prev).set(attachmentId, {
          status: 'processing',
          progress,
        }));
      });

      // Update attachment with transformed content
      setAttachments(prev => prev.map(a =>
        a.id === attachmentId ? { ...a, transformedContent } : a
      ));

      // Mark as done
      setProcessingState(prev => new Map(prev).set(attachmentId, { status: 'done' }));
    } catch (error) {
      console.error(`[useFileUpload] Transformation failed for ${file.name}:`, error);
      setProcessingState(prev => new Map(prev).set(attachmentId, { status: 'error' }));
    }
  }, []);

  /**
   * Validates and adds files to attachments.
   * If a transformer matches the file type, transformation starts immediately.
   */
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      // Check file size
      if (file.size > maxFileSize) {
        const errorMsg = strings.fileUpload.fileSizeError
          .replace('{filename}', file.name)
          .replace('{maxSize}', String(Math.round(maxFileSize / (1024 * 1024))));
        setFileError(errorMsg);
        continue;
      }

      // Check file type
      if (!isTypeAccepted(file.type, acceptedTypes)) {
        const errorMsg = strings.fileUpload.fileTypeError.replace('{type}', file.type);
        setFileError(errorMsg);
        continue;
      }

      // Generate preview for images
      const preview = await generateImagePreview(file);

      // Create attachment
      const attachmentId = uuidv4();
      const attachment: FileAttachment = {
        id: attachmentId,
        file,
        preview,
      };

      // Add to attachments
      setAttachments(prev => [...prev, attachment]);

      // Check for transformer and start transformation immediately
      const transformer = findTransformer(file.type, transformers);
      if (transformer) {
        // Run transformer in background (don't await - let it update state as it progresses)
        runTransformer(attachmentId, file, transformer);
      }
    }
  }, [maxFileSize, acceptedTypes, strings, transformers, runTransformer]);

  /**
   * Removes a file attachment by ID.
   */
  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
    setProcessingState(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  /**
   * Clears all attachments.
   */
  const clearAttachments = useCallback(() => {
    setAttachments([]);
    setProcessingState(new Map());
  }, []);

  /**
   * Opens the file picker dialog.
   */
  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * Handles file input change event.
   */
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
    // Reset input so the same file can be selected again
    e.target.value = '';
  }, [handleFiles]);

  // Drag and drop handlers using counter to prevent flickering
  // The counter approach: increment on dragenter, decrement on dragleave
  // Only show drop zone when counter > 0, reset to 0 on drop
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (enabled && !disabled) {
      dragCounterRef.current++;
      if (dragCounterRef.current === 1) {
        setIsDragging(true);
      }
    }
  }, [enabled, disabled]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    if (!enabled || disabled) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFiles(files);
    }
  }, [enabled, disabled, handleFiles]);

  /**
   * Returns props to spread on the drop zone container element.
   */
  const getDropZoneProps = useCallback((): DropZoneProps => ({
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  }), [handleDragEnter, handleDragOver, handleDragLeave, handleDrop]);

  /**
   * Overlay component that renders when dragging files over the drop zone.
   * Should be rendered inside the drop zone container (which needs position: relative or similar).
   */
  const DropZoneOverlay = useMemo(() => {
    if (!isDragging || !enabled) return null;

    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: theme.primaryColorTranslucent,
          border: `3px dashed ${theme.primaryColor}`,
          borderRadius: 'inherit',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1010,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            background: theme.backgroundColor,
            padding: '16px 24px',
            borderRadius: '12px',
            boxShadow: theme.buttonShadow,
          }}
        >
          <span style={{ color: theme.primaryColor, fontWeight: 600, fontSize: '16px' }}>
            {strings.fileUpload.dropFilesHere}
          </span>
        </div>
      </div>
    );
  }, [isDragging, enabled, theme, strings]);

  return {
    attachments,
    isDragging,
    fileError,
    enabled,
    maxFileSize,
    acceptedTypes,
    processingState,
    fileInputRef,
    handleFiles,
    removeAttachment,
    clearAttachments,
    openFilePicker,
    handleFileInputChange,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    getDropZoneProps,
    DropZoneOverlay,
  };
}
