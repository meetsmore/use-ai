import React, { useState, useEffect } from 'react';
import { InvisibleAIProvider, subscribeToLogs, clearLogs } from '../providers/InvisibleAIProvider';

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
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>Invisible Component Test</h1>
          <p style={styles.subtitle}>
            This page demonstrates an invisible AI provider component with no visual state.
            Tools from invisible components execute immediately without waiting for re-renders.
          </p>

          <div style={styles.infoBox}>
            <h3 style={styles.infoTitle}>How it works:</h3>
            <ol style={styles.infoList}>
              <li>The InvisibleAIProvider wraps this page</li>
              <li>It provides tools like "logMessage" to the AI</li>
              <li>These tools execute without triggering provider re-renders</li>
              <li>Try asking: "Log a message: [your text]"</li>
            </ol>
          </div>

          <LogDisplay />
        </div>
      </div>
    </InvisibleAIProvider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '20px',
  },
  card: {
    background: 'white',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    marginBottom: '8px',
    color: '#333',
  },
  subtitle: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '24px',
    lineHeight: '1.5',
  },
  infoBox: {
    background: '#f8f9fa',
    border: '1px solid #dee2e6',
    borderRadius: '6px',
    padding: '16px',
    marginBottom: '24px',
  },
  infoTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#333',
    marginTop: 0,
    marginBottom: '12px',
  },
  infoList: {
    margin: 0,
    paddingLeft: '20px',
    color: '#666',
    fontSize: '14px',
    lineHeight: '1.8',
  },
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
