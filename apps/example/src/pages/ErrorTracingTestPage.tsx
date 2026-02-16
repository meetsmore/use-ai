import React, { useState } from 'react';
import { useAIContext } from '@meetsmore-oss/use-ai-client';

export default function ErrorTracingTestPage() {
  const { chat, connected, agents } = useAIContext();
  const [isSending, setIsSending] = useState(false);

  const handleSendWithInvalidAgent = async (agentName: string) => {
    if (!connected || isSending) return;
    setIsSending(true);
    const previousAgent = agents.selected;
    try {
      agents.set(agentName);
      await chat.sendMessage(`Testing agent_not_found error with agent: ${agentName}`);
    } catch (error) {
      console.error('Expected error:', error);
    } finally {
      agents.set(previousAgent);
      setIsSending(false);
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Error Tracing Test</h1>
      <p style={styles.description}>
        Trigger server-side error scenarios to verify Langfuse error traces.
        Check server logs for <code style={styles.code}>recordErrorTrace</code> output.
      </p>

      <div style={styles.statusBadge} data-testid="connection-status">
        Status: {connected ? (
          <span style={styles.connected} data-testid="status-connected">Connected</span>
        ) : (
          <span style={styles.disconnected} data-testid="status-disconnected">Disconnected</span>
        )}
      </div>

      <section style={{ ...styles.section, borderLeft: '4px solid #ef4444' }}>
        <h2 style={styles.sectionTitle}>Error Scenarios</h2>
        <p style={styles.sectionDescription}>
          Click a button to trigger a specific error scenario. Verify that the corresponding error trace appears in Langfuse with ERROR level span.
        </p>
        <div style={styles.buttonGroup}>
          <button
            style={{ ...styles.button, ...styles.buttonDanger }}
            onClick={() => handleSendWithInvalidAgent('nonexistent-agent')}
            disabled={!connected || isSending}
            data-testid="btn-agent-not-found"
          >
            agent_not_found
          </button>
        </div>
        <p style={{ ...styles.sectionDescription, marginTop: '12px', marginBottom: 0 }}>
          Current agent: <code style={styles.code}>{agents.selected ?? agents.default ?? 'none'}</code>
          {' | '}Available: <code style={styles.code}>{agents.available.map(a => a.id).join(', ') || 'none'}</code>
        </p>
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '20px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    marginBottom: '8px',
    color: '#333',
  },
  description: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '24px',
    lineHeight: '1.5',
  },
  code: {
    background: '#f4f4f4',
    padding: '2px 6px',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '14px',
  },
  statusBadge: {
    marginBottom: '24px',
    fontSize: '14px',
  },
  connected: {
    color: '#22c55e',
    fontWeight: 'bold',
  },
  disconnected: {
    color: '#ef4444',
    fontWeight: 'bold',
  },
  section: {
    background: 'white',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '8px',
    color: '#333',
  },
  sectionDescription: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '16px',
  },
  buttonGroup: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  button: {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: '500',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    background: 'white',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  buttonDanger: {
    background: '#ef4444',
    color: 'white',
    borderColor: '#ef4444',
  },
};
