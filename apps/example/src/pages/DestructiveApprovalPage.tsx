import React, { useState } from 'react';
import { useAI, defineTool } from '@meetsmore-oss/use-ai-client';
import { z } from 'zod';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

export default function DestructiveApprovalPage() {
  const [items, setItems] = useState(['Document A', 'Document B', 'Document C', 'Spreadsheet X']);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) => setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const tools = {
    viewItem: defineTool(
      'View details of a specific item (read-only)',
      z.object({ name: z.string() }),
      (input) => {
        addLog(`Viewed: ${input.name}`);
        return { success: true, name: input.name, status: 'active' };
      },
      { annotations: { readOnlyHint: true, title: 'Viewing Item' } }
    ),

    deleteItem: defineTool(
      'Permanently delete a single item',
      z.object({
        name: z.string().describe('Name of the item to delete'),
      }),
      (input) => {
        setItems(prev => prev.filter(i => i !== input.name));
        addLog(`Deleted: ${input.name}`);
        return { success: true, message: `Deleted ${input.name}` };
      },
      { annotations: { destructiveHint: true, title: 'Deleting Item' } }
    ),

    deleteAll: defineTool(
      'Permanently delete all items at once',
      () => {
        const count = items.length;
        setItems([]);
        addLog(`Deleted all ${count} items`);
        return { success: true, message: `Deleted ${count} items` };
      },
      { annotations: { destructiveHint: true, title: 'Deleting All Items' } }
    ),

    restoreDefaults: defineTool(
      'Restore the default item list',
      () => {
        setItems(['Document A', 'Document B', 'Document C', 'Spreadsheet X']);
        addLog('Restored defaults');
        return { success: true };
      },
      { annotations: { title: 'Restoring Defaults' } }
    ),
  };

  useAI({
    tools,
    prompt: `Destructive Approval Demo. Items: ${items.length > 0 ? items.join(', ') : '(none)'}`,
  });

  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Destructive Approval</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          Tools with <code style={docStyles.code}>destructiveHint: true</code> require explicit
          user approval before execution. The AI pauses, shows a confirmation dialog listing
          the tool name and parameters, and waits for the user to Allow or Deny.
        </p>
        <p style={docStyles.text}>
          When the AI calls multiple destructive tools at once, they are batched into a
          single dialog with "Allow All" / "Deny All" buttons.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Code Example</h2>
        <CollapsibleCode>
{`// Single destructive tool
const deleteItem = defineTool(
  'Permanently delete a single item',
  z.object({ name: z.string() }),
  (input) => { /* ... */ },
  {
    annotations: {
      destructiveHint: true,     // Shows approval dialog
      title: 'Deleting Item',    // Displayed in dialog header
    },
  }
);

// The title annotation is shown in the approval dialog:
//   ┌─────────────────────────────────┐
//   │  Confirmation Required          │
//   │                                 │
//   │  Deleting Item                  │
//   │  The AI wants to execute:       │
//   │  deleteItem({ name: "Doc A" })  │
//   │                                 │
//   │  [Deny]  [Allow]               │
//   └─────────────────────────────────┘`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.contextCard}>
        <h2 style={docStyles.subtitle}>Batch Approval</h2>
        <p style={docStyles.text}>
          When the AI calls multiple destructive tools in one turn (e.g., "delete all
          items one by one"), the approval dialog batches them into a single prompt with
          "Allow All" and "Deny All" options. Individual tools can still be approved or
          denied one at a time.
        </p>
        <p style={docStyles.text}>
          Try: "Delete Document A and Document B" to see the batch dialog.
        </p>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          Try: "Delete Document A" (single approval), "Delete all items" (single call), or
          "Delete Document A, B, and C one by one" (batch approval).
        </p>

        <div style={styles.itemList}>
          <h3 style={styles.listTitle}>Items ({items.length})</h3>
          {items.length === 0 ? (
            <p style={styles.emptyState}>No items. Ask the AI to "restore defaults".</p>
          ) : (
            items.map(item => (
              <div key={item} style={styles.item}>{item}</div>
            ))
          )}
        </div>

        {log.length > 0 && (
          <div style={styles.logSection}>
            <div style={styles.logHeader}>
              <h3 style={styles.listTitle}>Action Log</h3>
              <button onClick={() => setLog([])} style={styles.clearButton}>Clear</button>
            </div>
            <div style={styles.logContainer}>
              {log.map((entry, i) => (
                <div key={i} style={styles.logEntry}>{entry}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  itemList: {
    marginBottom: '16px',
  },
  listTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '8px',
    marginTop: 0,
  },
  item: {
    padding: '10px 14px',
    background: '#f9fafb',
    borderRadius: '6px',
    marginBottom: '6px',
    fontSize: '13px',
    color: '#374151',
    border: '1px solid #e5e7eb',
  },
  emptyState: {
    color: '#9ca3af',
    fontStyle: 'italic',
    fontSize: '13px',
    margin: 0,
  },
  logSection: {
    marginTop: '16px',
  },
  logHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  clearButton: {
    padding: '4px 10px',
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#dc2626',
  },
  logContainer: {
    background: '#1f2937',
    borderRadius: '6px',
    padding: '12px',
    maxHeight: '150px',
    overflowY: 'auto',
    fontFamily: 'monospace',
  },
  logEntry: {
    color: '#d1d5db',
    fontSize: '12px',
    lineHeight: '1.5',
  },
};
