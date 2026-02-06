import React, { useState } from 'react';
import type { ToolAnnotations } from '../types';
import type { UseAITheme, UseAIStrings } from '../theme';

/**
 * A single pending tool approval item.
 */
export interface PendingToolItem {
  toolCallId: string;
  toolCallName: string;
  toolCallArgs: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

/**
 * Props for the ToolApprovalDialog component.
 */
export interface ToolApprovalDialogProps {
  /** The name of the tool requesting approval (first tool in batch) */
  toolCallName: string;
  /** The arguments passed to the tool (first tool in batch) */
  toolCallArgs: Record<string, unknown>;
  /** Optional tool annotations (e.g., title for display) */
  annotations?: ToolAnnotations;
  /** Number of tool calls awaiting approval (for batch mode) */
  toolCount?: number;
  /** All pending tools (for batch mode details view) */
  pendingTools?: PendingToolItem[];
  /** Callback when user approves the tool execution (all tools in batch) */
  onApprove: () => void;
  /** Callback when user rejects the tool execution (all tools in batch) */
  onReject: (reason?: string) => void;
  /** Theme configuration for styling */
  theme: UseAITheme;
  /** Localized strings for UI text */
  strings: UseAIStrings;
}

/**
 * Confirmation dialog for destructive tool calls.
 * Replaces the chat input area when approval is needed.
 */
export function ToolApprovalDialog({
  toolCallName,
  toolCallArgs,
  annotations,
  toolCount = 1,
  pendingTools = [],
  onApprove,
  onReject,
  theme,
  strings,
}: ToolApprovalDialogProps) {
  const [showDetails, setShowDetails] = useState(false);

  const displayName = annotations?.title || toolCallName;
  const isBatch = toolCount > 1;

  // For batch mode, show count; otherwise show the tool name
  const message = isBatch
    ? strings.toolApproval.batchMessage?.replace('{count}', String(toolCount))
      ?? `${toolCount} actions are waiting for your approval`
    : strings.toolApproval.message.replace('{toolName}', displayName);

  // Get display name for a tool (use annotation title if available)
  const getToolDisplayName = (tool: PendingToolItem) =>
    tool.annotations?.title || tool.toolCallName;

  return (
    <div
      data-testid="tool-approval-dialog"
      style={{
        border: `2px solid ${theme.primaryColor}`,
        borderRadius: '12px',
        background: theme.backgroundColor,
        overflow: 'hidden',
      }}
    >
      {/* Header with warning icon and message */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: `1px solid ${theme.borderColor}`,
          background: theme.assistantMessageBackground,
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '4px',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.primaryColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span style={{
            fontWeight: 600,
            fontSize: '14px',
            color: theme.textColor,
          }}>
            {strings.toolApproval.title}
          </span>
        </div>
        <div style={{
          fontSize: '13px',
          color: theme.secondaryTextColor,
          paddingLeft: '24px',
        }}>
          {message}
        </div>
      </div>

      {/* Collapsible details */}
      <div style={{ padding: '8px 14px' }}>
        <button
          onClick={() => setShowDetails(!showDetails)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: '12px',
            color: theme.secondaryTextColor,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 12 12"
            fill="none"
            style={{
              transform: showDetails ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s',
            }}
          >
            <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {strings.toolApproval.showDetails}
        </button>
        {showDetails && (
          <div style={{
            marginTop: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            maxHeight: '200px',
            overflow: 'auto',
          }}>
            {/* Use pendingTools if available, otherwise create a single-item list from props */}
            {(pendingTools.length > 0 ? pendingTools : [{
              toolCallId: 'single',
              toolCallName,
              toolCallArgs,
              annotations,
            }]).map((tool, index) => (
              <div
                key={tool.toolCallId}
                style={{
                  padding: '8px',
                  background: theme.hoverBackground,
                  borderRadius: '6px',
                }}
              >
                <div style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: theme.textColor,
                  marginBottom: '4px',
                }}>
                  {getToolDisplayName(tool)}
                </div>
                <pre style={{
                  margin: 0,
                  fontSize: '11px',
                  overflow: 'auto',
                  color: theme.secondaryTextColor,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {JSON.stringify(tool.toolCallArgs, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{
        display: 'flex',
        gap: '8px',
        padding: '8px 14px 12px',
      }}>
        <button
          data-testid="approve-tool-button"
          onClick={onApprove}
          style={{
            flex: 1,
            padding: '8px 16px',
            borderRadius: '8px',
            border: 'none',
            background: theme.primaryGradient,
            color: 'white',
            fontWeight: 500,
            cursor: 'pointer',
            fontSize: '13px',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.currentTarget.style.opacity = '0.9';
          }}
          onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.currentTarget.style.opacity = '1';
          }}
        >
          {isBatch
            ? (strings.toolApproval.approveAll ?? 'Approve All')
            : strings.toolApproval.approve}
        </button>
        <button
          data-testid="reject-tool-button"
          onClick={() => onReject()}
          style={{
            flex: 1,
            padding: '8px 16px',
            borderRadius: '8px',
            border: `1px solid ${theme.borderColor}`,
            background: 'transparent',
            color: theme.textColor,
            fontWeight: 500,
            cursor: 'pointer',
            fontSize: '13px',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.currentTarget.style.background = theme.hoverBackground;
          }}
          onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {isBatch
            ? (strings.toolApproval.rejectAll ?? 'Reject All')
            : strings.toolApproval.reject}
        </button>
      </div>
    </div>
  );
}
