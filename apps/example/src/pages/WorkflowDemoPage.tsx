import React, { useState } from 'react';
import { useAIWorkflow, defineTool, z } from '@meetsmore-oss/use-ai-client';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

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
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Workflow Integration</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          Workflows are headless, button-triggered operations — the opposite of conversational chat.
          They execute a predefined pipeline on an external platform (like Dify) and can call
          frontend tools mid-execution to update the UI.
        </p>
        <p style={docStyles.text}>
          Unlike agents (multi-turn, conversational), workflows are stateless single-run
          operations. Use <code style={docStyles.code}>useAIWorkflow</code> on the client
          and configure <code style={docStyles.code}>WorkflowsPlugin</code> on the server.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Code Example — Server</h2>
        <CollapsibleCode>
{`import { UseAIServer } from '@meetsmore-oss/use-ai-server';
import { WorkflowsPlugin, DifyWorkflowRunner } from '@meetsmore-oss/use-ai-plugin-workflows';

new UseAIServer({
  agents: { /* ... */ },
  plugins: [
    new WorkflowsPlugin({
      runners: new Map([
        ['dify', new DifyWorkflowRunner({
          apiBaseUrl: process.env.DIFY_API_URL || 'http://localhost:3001/v1',
          workflows: {
            'greeting-workflow': process.env.DIFY_GREETING_WORKFLOW_KEY!,
          },
        })],
      ]),
    }),
  ],
});`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Code Example — Client</h2>
        <CollapsibleCode>
{`import { useAIWorkflow, defineTool, z } from '@meetsmore-oss/use-ai-client';

function WorkflowButton() {
  const { trigger, status, text, connected } = useAIWorkflow('dify', 'app-xxx');

  const handleClick = async () => {
    await trigger({
      inputs: { username: 'Alice' },
      tools: {
        displayGreeting: defineTool(
          'Display a greeting',
          z.object({ greeting: z.string() }),
          (input) => { showGreeting(input.greeting); return { success: true }; }
        ),
      },
      onProgress: (p) => console.log(p),
      onComplete: (r) => console.log('Done:', r),
    });
  };

  return <button onClick={handleClick} disabled={!connected || status === 'running'}>Run</button>;
}`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          Enter your Dify workflow API key and run a workflow. Requires a running Dify instance.
        </p>

        <div style={styles.statusBadge}>
          <span style={{...styles.dot, backgroundColor: connected ? '#22c55e' : '#ef4444'}} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>

        <div style={styles.grid}>
          {/* Workflow Controls */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Controls</h3>
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
            </div>
            <div style={styles.buttonGroup}>
              <button
                onClick={handleDifyWorkflow}
                disabled={!connected || status === 'running' || !workflowApiKey.trim()}
                style={{
                  ...styles.button,
                  ...((!connected || status === 'running' || !workflowApiKey.trim()) ? styles.buttonDisabled : {}),
                }}
              >
                {status === 'running' ? 'Running...' : 'Run Dify Workflow'}
              </button>
              <button
                onClick={clearLogs}
                disabled={workflowLogs.length === 0}
                style={{
                  ...styles.clearButton,
                  ...(workflowLogs.length === 0 ? styles.buttonDisabled : {}),
                }}
              >
                Clear
              </button>
            </div>
            <div style={styles.statusDisplay}>
              <span>Status:</span>
              <span style={{
                fontWeight: '600',
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

          {/* Response + Tool Calls */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Response</h3>
            {!text ? (
              <p style={styles.emptyState}>No response yet.</p>
            ) : (
              <div style={styles.responseBox}>{text}</div>
            )}
            <h3 style={{ ...styles.cardTitle, marginTop: '16px' }}>Tool Calls</h3>
            {processedItems.length === 0 ? (
              <p style={styles.emptyState}>No tool calls yet.</p>
            ) : (
              <ul style={styles.list}>
                {processedItems.map((item, index) => (
                  <li key={index} style={styles.listItem}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Logs */}
        {workflowLogs.length > 0 && (
          <div style={styles.logContainer}>
            {workflowLogs.map((log, index) => (
              <div key={index} style={styles.logEntry}>{log}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 12px',
    background: '#f3f4f6',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    marginBottom: '16px',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
    marginBottom: '16px',
  },
  card: {
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '16px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '12px',
    marginTop: 0,
  },
  inputGroup: {
    marginBottom: '12px',
  },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    fontSize: '13px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  inputDisabled: {
    backgroundColor: '#f3f4f6',
    cursor: 'not-allowed',
  },
  buttonGroup: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px',
  },
  button: {
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    background: '#3b82f6',
    color: 'white',
  },
  clearButton: {
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    background: '#ef4444',
    color: 'white',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  statusDisplay: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    background: 'white',
    borderRadius: '6px',
    fontSize: '13px',
    color: '#6b7280',
  },
  errorBox: {
    marginTop: '8px',
    padding: '8px 12px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    color: '#991b1b',
    fontSize: '13px',
  },
  emptyState: {
    color: '#9ca3af',
    fontStyle: 'italic',
    fontSize: '13px',
    margin: 0,
  },
  responseBox: {
    padding: '12px',
    background: 'white',
    borderRadius: '6px',
    fontSize: '13px',
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
    padding: '8px 12px',
    background: 'white',
    borderRadius: '6px',
    marginBottom: '4px',
    fontSize: '13px',
    color: '#374151',
  },
  logContainer: {
    background: '#1f2937',
    borderRadius: '8px',
    padding: '12px 16px',
    maxHeight: '200px',
    overflowY: 'auto',
    fontFamily: 'monospace',
  },
  logEntry: {
    color: '#d1d5db',
    fontSize: '12px',
    marginBottom: '2px',
    lineHeight: '1.5',
  },
};
