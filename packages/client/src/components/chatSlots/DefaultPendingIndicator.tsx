import React from 'react';
import { useStrings, useTheme } from '../../theme';
import type { ChatPendingIndicatorSlotProps } from './types';

/**
 * The bubble shown between a run starting and its answer producing a first
 * token, and while a send-time file transformation runs.
 */
export function DefaultPendingIndicator({ fileProcessing }: ChatPendingIndicatorSlotProps) {
  const theme = useTheme();
  const strings = useStrings();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
      }}
    >
      <div
        className="markdown-content"
        style={{
          padding: '10px 14px',
          borderRadius: '12px',
          background: theme.assistantMessageBackground,
          fontSize: '14px',
          lineHeight: '1.5',
          color: theme.textColor,
          maxWidth: '80%',
        }}
      >
        {fileProcessing && fileProcessing.status === 'processing' ? (
          <div>
            <span style={{ opacity: 0.6 }}>{strings.input.processingFile}</span>
            {fileProcessing.progress != null && (
              <>
                <span style={{ opacity: 0.6, marginLeft: '4px' }}>
                  {Math.round(fileProcessing.progress)}%
                </span>
                <div style={{
                  marginTop: '6px',
                  height: '4px',
                  borderRadius: '2px',
                  background: theme.borderColor,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${fileProcessing.progress}%`,
                    borderRadius: '2px',
                    background: theme.primaryColor,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </>
            )}
            {fileProcessing.progress == null && (
              <span className="dots" style={{ marginLeft: '4px' }}>...</span>
            )}
          </div>
        ) : (
          <span className="dots" style={{ opacity: 0.6 }}>...</span>
        )}
      </div>
    </div>
  );
}
