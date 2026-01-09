import React, { useState } from 'react';
import { useAIWorkflow, defineTool, z } from '@meetsmore-oss/use-ai-client';

/**
 * Example page demonstrating headless workflow execution.
 *
 * This shows how to use workflows for background operations that:
 * - Don't need chat UI
 * - Can use external platforms (Dify, Flowise, etc.)
 * - Can still call frontend tools mid-execution
 */
export default function WorkflowDemoPage() {
  const [workflowApiKey, setWorkflowApiKey] = useState('');
  const [processedItems, setProcessedItems] = useState<string[]>([]);
  const [workflowLogs, setWorkflowLogs] = useState<string[]>([]);

  // Dify workflow for API-first workflow execution
  // For Dify, the workflowId IS the API key
  const { trigger, status, text, error, connected } = useAIWorkflow('dify', workflowApiKey);

  const addLog = (message: string) => {
    setWorkflowLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  // Dify workflow
  const handleDifyWorkflow = async () => {
    addLog('Starting Dify workflow...');
    setProcessedItems([]);

    await trigger({
      inputs: {
        username: 'Alice',
      },
      tools: {
        displayGreeting: defineTool(
          'Display a greeting message to the user',
          z.object({
            greeting: z.string().describe('The greeting message to display'),
          }),
          (input) => {
            addLog(`Tool called: displayGreeting`);
            setProcessedItems((prev) => [...prev, input.greeting]);
            return { success: true };
          }
        ),
      },
      onProgress: (progress) => {
        addLog(`Progress: ${progress.status}${progress.text ? ` - ${progress.text}` : ''}`);
      },
      onComplete: (result) => {
        addLog('Workflow completed!');
      },
      onError: (err) => {
        addLog(`Error: ${err.message}`);
      },
    });
  };

  const clearLogs = () => {
    setWorkflowLogs([]);
    setProcessedItems([]);
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Dify Workflow Demo</h1>
        <p style={styles.subtitle}>
          Trigger Dify workflows without chat UI. Create workflows in Dify and execute them from
          your React app with proper variable support and tool callbacks.
        </p>
        <div style={styles.statusBadge}>
          <span style={{...styles.dot, backgroundColor: connected ? '#22c55e' : '#ef4444'}} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      <div style={styles.grid}>
        {/* Workflow Controls */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Workflow Controls</h2>

          {/* API Key Input */}
          <div style={styles.inputGroup}>
            <label style={styles.label}>Dify App API Key</label>
            <input
              type="text"
              value={workflowApiKey}
              onChange={(e) => setWorkflowApiKey(e.target.value)}
              placeholder="app-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              disabled={status === 'running'}
              style={{
                ...styles.input,
                ...(status === 'running' ? styles.inputDisabled : {}),
              }}
            />
            <p style={styles.hint}>
              Enter your Dify app workflow API key (found in API Access settings)
            </p>
          </div>

          <div style={styles.buttonGroup}>
            <button
              onClick={handleDifyWorkflow}
              disabled={!connected || status === 'running' || !workflowApiKey.trim()}
              style={{
                ...styles.button,
                ...styles.buttonPrimary,
                ...((!connected || status === 'running' || !workflowApiKey.trim()) ? styles.buttonDisabled : {}),
              }}
            >
              {status === 'running' ? 'Running...' : 'Run Dify Workflow'}
            </button>
            <button
              onClick={clearLogs}
              disabled={workflowLogs.length === 0}
              style={{
                ...styles.button,
                ...styles.buttonDanger,
                ...(workflowLogs.length === 0 ? styles.buttonDisabled : {}),
              }}
            >
              Clear Logs
            </button>
          </div>

          {/* Status Display */}
          <div style={styles.statusSection}>
            <h3 style={styles.sectionTitle}>Status</h3>
            <div style={styles.statusDisplay}>
              <span style={styles.statusLabel}>Workflow Status:</span>
              <span style={{
                ...styles.statusValue,
                color: status === 'completed' ? '#22c55e' : status === 'error' ? '#ef4444' : '#3b82f6',
              }}>
                {status.toUpperCase()}
              </span>
            </div>
            {error && (
              <div style={styles.errorBox}>
                <strong>Error:</strong> {error.message}
              </div>
            )}
          </div>
        </div>

        {/* Workflow Response */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Workflow Response</h2>
          {!text ? (
            <p style={styles.emptyState}>No response yet. Trigger a workflow to see the result.</p>
          ) : (
            <div style={styles.responseBox}>
              {text}
            </div>
          )}
        </div>

        {/* Processed Items */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Tool Calls</h2>
          {processedItems.length === 0 ? (
            <p style={styles.emptyState}>No tool calls yet. Tools will appear here when the workflow calls them.</p>
          ) : (
            <ul style={styles.list}>
              {processedItems.map((item, index) => (
                <li key={index} style={styles.listItem}>
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Workflow Logs */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Workflow Logs</h2>
        {workflowLogs.length === 0 ? (
          <p style={styles.emptyState}>No logs yet. Trigger a workflow to see activity.</p>
        ) : (
          <div style={styles.logContainer}>
            {workflowLogs.map((log, index) => (
              <div key={index} style={styles.logEntry}>
                {log}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info Box */}
      <div style={styles.infoBox}>
        <h3 style={styles.infoTitle}>💡 How it works</h3>
        <ul style={styles.infoList}>
          <li><strong>Dify Integration:</strong> Trigger workflows built in Dify without chat UI</li>
          <li><strong>API Key:</strong> Enter the app API key from Dify (found in API Access settings)</li>
          <li><strong>Variables:</strong> Pass dynamic inputs to workflows - they just work (no pre-configuration needed!)</li>
          <li><strong>Tool Calls:</strong> Workflows can call frontend tools mid-execution to update the UI</li>
          <li><strong>Setup Required:</strong> Start Dify with docker-compose and create a workflow (see docker/dify/README.md)</li>
          <li><strong>Progress Tracking:</strong> Monitor workflow status and tool calls in real-time</li>
        </ul>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
  },
  header: {
    marginBottom: '32px',
  },
  title: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#6b7280',
    marginBottom: '16px',
  },
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    background: '#f3f4f6',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px',
    marginBottom: '20px',
  },
  card: {
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  cardTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '16px',
  },
  inputGroup: {
    marginBottom: '20px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '8px',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box',
  },
  inputDisabled: {
    backgroundColor: '#f3f4f6',
    cursor: 'not-allowed',
  },
  hint: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '6px',
    fontStyle: 'italic',
  },
  buttonGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '24px',
  },
  button: {
    padding: '12px 20px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  buttonPrimary: {
    background: '#3b82f6',
    color: 'white',
  },
  buttonSecondary: {
    background: '#8b5cf6',
    color: 'white',
  },
  buttonSuccess: {
    background: '#10b981',
    color: 'white',
  },
  buttonDanger: {
    background: '#ef4444',
    color: 'white',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  statusSection: {
    borderTop: '1px solid #e5e7eb',
    paddingTop: '16px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '12px',
  },
  statusDisplay: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    background: '#f9fafb',
    borderRadius: '6px',
  },
  statusLabel: {
    fontSize: '14px',
    color: '#6b7280',
  },
  statusValue: {
    fontSize: '14px',
    fontWeight: '600',
  },
  errorBox: {
    marginTop: '12px',
    padding: '12px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    color: '#991b1b',
    fontSize: '14px',
  },
  emptyState: {
    color: '#9ca3af',
    fontStyle: 'italic',
    fontSize: '14px',
  },
  responseBox: {
    padding: '16px',
    background: '#f9fafb',
    borderRadius: '8px',
    fontSize: '14px',
    color: '#374151',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap',
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  listItem: {
    padding: '12px',
    background: '#f9fafb',
    borderRadius: '6px',
    marginBottom: '8px',
    fontSize: '14px',
    color: '#374151',
  },
  logContainer: {
    background: '#1f2937',
    borderRadius: '8px',
    padding: '16px',
    maxHeight: '400px',
    overflowY: 'auto',
    fontFamily: 'monospace',
  },
  logEntry: {
    color: '#d1d5db',
    fontSize: '12px',
    marginBottom: '4px',
    lineHeight: '1.5',
  },
  infoBox: {
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: '12px',
    padding: '24px',
    marginTop: '20px',
  },
  infoTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1e40af',
    marginBottom: '12px',
  },
  infoList: {
    margin: 0,
    paddingLeft: '20px',
    color: '#1e40af',
    fontSize: '14px',
    lineHeight: '1.8',
  },
};
