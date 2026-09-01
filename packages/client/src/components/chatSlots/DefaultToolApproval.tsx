import React from 'react';
import { useStrings, useTheme } from '../../theme';
import { ToolApprovalDialog } from '../ToolApprovalDialog';
import type { ChatToolApprovalSlotProps } from './types';

/** Confirmation controls for tool calls the AI may not run unattended. */
export function DefaultToolApproval({ approvals, onApprove, onReject }: ChatToolApprovalSlotProps) {
  const theme = useTheme();
  const strings = useStrings();

  return (
    <div
      style={{
        padding: '16px',
        borderTop: `1px solid ${theme.borderColor}`,
      }}
    >
      <ToolApprovalDialog
        toolCallName={approvals[0].toolCallName}
        toolCallArgs={approvals[0].toolCallArgs}
        annotations={approvals[0].annotations}
        toolCount={approvals.length}
        pendingTools={approvals}
        onApprove={onApprove}
        onReject={onReject}
        theme={theme}
        strings={strings}
      />
    </div>
  );
}
