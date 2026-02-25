import React, { useState, useEffect } from 'react';
import { InvisibleAIProvider, subscribeToLogs, clearLogs } from '../providers/InvisibleAIProvider';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

function LogDisplay() {
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToLogs(setLogs);
    return unsubscribe;
  }, []);

  return (
    <div style={styles.logContainer}>
      <div style={styles.logHeader}>
        <h2 style={styles.logTitle}>System Logs</h2>
        <button onClick={clearLogs} style={styles.clearButton}>
          Clear Logs
        </button>
      </div>
      <div style={styles.logList}>
        {logs.length === 0 ? (
          <p style={styles.emptyState}>No logs yet</p>
        ) : (
          logs.map((log, index) => (
            <div key={index} style={styles.logItem}>
              <span style={styles.logIndex}>#{index + 1}</span>
              <span style={styles.logText}>{log}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function InvisibleTestPage() {
  return (
    <InvisibleAIProvider>
      <div style={docStyles.container}>
        <h1 style={docStyles.title}>Invisible Providers</h1>

        <div style={docStyles.infoCard}>
          <h2 style={docStyles.subtitle}>About</h2>
          <p style={docStyles.text}>
            Components with <code style={docStyles.code}>invisible: true</code> register tools
            without participating in render cycles. Their tools execute immediately without
            waiting for re-renders, making them ideal for global actions (navigation, logging,
            notifications) that don't have visual state.
          </p>
          <p style={docStyles.text}>
            A real-world example is the <code style={docStyles.code}>NavigationAIProvider</code>{' '}
            that wraps this entire example app — it provides{' '}
            <code style={docStyles.code}>navigateTo</code> and{' '}
            <code style={docStyles.code}>getCurrentPage</code> tools on every page.
          </p>
        </div>

        <div style={docStyles.definitionCard}>
          <h2 style={docStyles.subtitle}>Code Example</h2>
          <CollapsibleCode>
{`function InvisibleAIProvider({ children }: { children: ReactNode }) {
  const tools = {
    logMessage: defineTool(
      'Log a message to the system log',
      z.object({ message: z.string() }),
      (input) => {
        addLog(input.message);
        return { success: true };
      }
    ),
  };

  useAI({
    tools,
    prompt: 'Invisible provider — tools only, no visual state',
    invisible: true,  // No render cycle participation
  });

  return <>{children}</>;
}`}
          </CollapsibleCode>
        </div>

        <div style={docStyles.demoCard}>
          <h2 style={docStyles.subtitle}>Interactive Demo</h2>
          <p style={docStyles.text}>
            Try asking: "Log a message: Hello from the AI"
          </p>
          <LogDisplay />
        </div>
      </div>
    </InvisibleAIProvider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  logContainer: {
    border: '1px solid #dee2e6',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  logHeader: {
    background: '#f8f9fa',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid #dee2e6',
  },
  logTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#333',
    margin: 0,
  },
  clearButton: {
    padding: '6px 12px',
    background: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500',
  },
  logList: {
    padding: '16px',
    minHeight: '200px',
    maxHeight: '400px',
    overflowY: 'auto',
  },
  emptyState: {
    textAlign: 'center',
    color: '#999',
    fontSize: '14px',
    padding: '40px 20px',
    margin: 0,
  },
  logItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    background: '#f8f9fa',
    borderRadius: '4px',
    marginBottom: '8px',
    gap: '12px',
  },
  logIndex: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#6c757d',
    minWidth: '30px',
  },
  logText: {
    fontSize: '14px',
    color: '#333',
    flex: 1,
  },
};
