import React from 'react';
import type { FileAttachment } from '../fileUpload/types';
import { useTheme } from '../theme';

/**
 * Props for the FileChip component.
 */
export interface FileChipProps {
  /** The file attachment to display */
  attachment: FileAttachment;
  /** Callback when the remove button is clicked */
  onRemove: () => void;
  /** Whether the chip is disabled (e.g., during sending) */
  disabled?: boolean;
}

/**
 * Formats file size in human-readable format.
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Truncates filename if too long, preserving the extension.
 */
function truncateFilename(name: string, maxLength: number = 20): string {
  if (name.length <= maxLength) return name;

  const lastDot = name.lastIndexOf('.');
  const ext = lastDot > 0 ? name.substring(lastDot) : '';
  const baseName = lastDot > 0 ? name.substring(0, lastDot) : name;

  const maxBaseLength = maxLength - ext.length - 3; // 3 for "..."
  if (maxBaseLength < 5) return name.substring(0, maxLength - 3) + '...';

  return baseName.substring(0, maxBaseLength) + '...' + ext;
}

/**
 * A chip component that displays a file attachment with preview and remove button.
 *
 * Features:
 * - Shows image preview for image files
 * - Displays file icon for non-image files
 * - Shows truncated filename and file size
 * - Has a remove button (×)
 */
export function FileChip({ attachment, onRemove, disabled }: FileChipProps) {
  const theme = useTheme();
  const { file, preview } = attachment;
  const isImage = file.type.startsWith('image/');

  return (
    <div
      data-testid="file-chip"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 10px',
        background: theme.hoverBackground,
        borderRadius: '8px',
        fontSize: '13px',
        color: theme.textColor,
        maxWidth: '200px',
      }}
    >
      {/* Preview or icon */}
      {isImage && preview ? (
        <img
          src={preview}
          alt={file.name}
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '4px',
            objectFit: 'cover',
          }}
        />
      ) : (
        <div
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '4px',
            background: theme.borderColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px',
          }}
        >
          📎
        </div>
      )}

      {/* File info */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div
          style={{
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={file.name}
        >
          {truncateFilename(file.name)}
        </div>
        <div style={{ fontSize: '11px', color: theme.secondaryTextColor }}>
          {formatFileSize(file.size)}
        </div>
      </div>

      {/* Remove button */}
      <button
        data-testid="file-chip-remove"
        onClick={onRemove}
        disabled={disabled}
        style={{
          background: 'transparent',
          border: 'none',
          padding: '2px 4px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: theme.placeholderTextColor,
          fontSize: '16px',
          lineHeight: 1,
          borderRadius: '4px',
          transition: 'all 0.15s',
          opacity: disabled ? 0.5 : 1,
        }}
        onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
          if (!disabled) {
            e.currentTarget.style.background = theme.borderColor;
            e.currentTarget.style.color = theme.textColor;
          }
        }}
        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = theme.placeholderTextColor;
        }}
      >
        ×
      </button>
    </div>
  );
}

/**
 * Props for the FilePlaceholder component.
 */
export interface FilePlaceholderProps {
  /** File name to display */
  name: string;
  /** File size in bytes */
  size: number;
}

/**
 * A placeholder component shown for files that are no longer available
 * (e.g., when loading a persisted message with file references).
 */
export function FilePlaceholder({ name, size }: FilePlaceholderProps) {
  const theme = useTheme();

  return (
    <div
      data-testid="file-placeholder"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 10px',
        background: theme.backgroundColor,
        border: `1px dashed ${theme.dashedBorderColor}`,
        borderRadius: '8px',
        fontSize: '13px',
        color: theme.placeholderTextColor,
        maxWidth: '200px',
      }}
    >
      <span>📎</span>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={name}
        >
          {truncateFilename(name)}
        </div>
        <div style={{ fontSize: '11px' }}>
          {formatFileSize(size)}
        </div>
      </div>
    </div>
  );
}
