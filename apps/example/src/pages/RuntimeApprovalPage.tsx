import React, { useState } from 'react';
import { useAI, defineTool } from '@meetsmore-oss/use-ai-client';
import { z } from 'zod';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

export default function RuntimeApprovalPage() {
  const [log, setLog] = useState<string[]>([]);
  const [balance, setBalance] = useState(10000);

  const addLog = (msg: string) =>
    setLog((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] ${msg}`,
    ]);

  const tools = {
    checkBalance: defineTool(
      'Check the current account balance',
      () => {
        addLog('Checked balance');
        return { balance };
      },
      { annotations: { readOnlyHint: true, title: 'Check Balance' } }
    ),

    clientTransfer: defineTool(
      'Transfer money to another account. Requires user approval for large amounts (over 1000).',
      z.object({
        to: z.string().describe('Recipient account name'),
        amount: z.number().describe('Amount to transfer'),
      }),
      async (input, ctx) => {
        if (input.amount > 1000) {
          addLog(
            `Large transfer detected: $${input.amount} to ${input.to} — requesting approval...`
          );
          const { approved, reason } = await ctx.requestApproval({
            message: `Transfer $${input.amount} to "${input.to}"? This exceeds the $1,000 threshold.`,
            metadata: { amount: input.amount, to: input.to },
          });
          if (!approved) {
            addLog(
              `Transfer REJECTED by user${reason ? `: ${reason}` : ''}`
            );
            return {
              error: 'User rejected the transfer',
              reason,
            };
          }
          addLog(`Transfer APPROVED by user`);
        }
        setBalance((prev) => prev - input.amount);
        addLog(`Transferred $${input.amount} to ${input.to}`);
        return {
          success: true,
          message: `Transferred $${input.amount} to ${input.to}`,
          newBalance: balance - input.amount,
        };
      }
    ),

    resetBalance: defineTool('Reset account balance to $10,000', () => {
      setBalance(10000);
      addLog('Balance reset to $10,000');
      return { success: true, balance: 10000 };
    }),
  };

  useAI({
    tools,
    prompt: `Runtime Approval Demo — Bank Account. Current balance: $${balance}. Transfers over $1,000 require user approval via ctx.requestApproval().`,
    suggestions: [
      'Transfer $500 to Alice',
      'Transfer $2000 to Bob',
      'Transfer $100 to Carol and $5000 to Dave',
    ],
  });

  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Runtime Interactive Approval</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          Unlike static <code style={docStyles.code}>destructiveHint</code>,
          runtime approval uses{' '}
          <code style={docStyles.code}>ctx.requestApproval()</code> inside the
          tool function to conditionally ask for user confirmation based on
          runtime values.
        </p>
        <p style={docStyles.text}>
          In this demo, transfers under $1,000 execute immediately, while
          larger transfers pause and prompt the user for approval.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Code Example</h2>
        <CollapsibleCode>
          {`const transfer = defineTool(
  'Transfer money',
  z.object({ to: z.string(), amount: z.number() }),
  async (input, ctx) => {
    if (input.amount > 1000) {
      const { approved } = await ctx.requestApproval({
        message: \`Transfer $\${input.amount} to "\${input.to}"?\`,
      });
      if (!approved) return { error: 'Rejected' };
    }
    // proceed with transfer...
  }
);`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          Try: "Transfer $500 to Alice" (no approval needed) vs "Transfer
          $2000 to Bob" (approval required).
        </p>

        <div style={styles.balanceCard}>
          <span style={styles.balanceLabel}>Account Balance</span>
          <span style={styles.balanceValue}>${balance.toLocaleString()}</span>
        </div>

        {log.length > 0 && (
          <div style={styles.logSection}>
            <div style={styles.logHeader}>
              <h3 style={styles.listTitle}>Action Log</h3>
              <button
                onClick={() => setLog([])}
                style={styles.clearButton}
              >
                Clear
              </button>
            </div>
            <div style={styles.logContainer}>
              {log.map((entry, i) => (
                <div key={i} style={styles.logEntry}>
                  {entry}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  balanceCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  balanceLabel: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#166534',
  },
  balanceValue: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#15803d',
  },
  listTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '8px',
    marginTop: 0,
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
    maxHeight: '200px',
    overflowY: 'auto',
    fontFamily: 'monospace',
  },
  logEntry: {
    color: '#d1d5db',
    fontSize: '12px',
    lineHeight: '1.5',
  },
};
