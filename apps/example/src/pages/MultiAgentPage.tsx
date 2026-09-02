import React from 'react';
import { useAIContext } from '@meetsmore-oss/use-ai-client';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

function AgentInfo() {
  const { agents } = useAIContext();

  return (
    <div style={styles.agentPanel}>
      <div style={styles.agentSection}>
        <h3 style={styles.sectionTitle}>Available Agents</h3>
        {agents.available.length === 0 ? (
          <p style={styles.emptyState}>No agents available (server may not support multiple agents)</p>
        ) : (
          agents.available.map(agent => (
            <div
              key={agent.id}
              style={{
                ...styles.agentItem,
                ...(agents.selected === agent.id ? styles.agentItemActive : {}),
              }}
            >
              <span style={styles.agentName}>{agent.name || agent.id}</span>
              <span style={styles.agentId}>{agent.id}</span>
              {agents.default === agent.id && (
                <span style={styles.defaultBadge}>default</span>
              )}
            </div>
          ))
        )}
      </div>

      <div style={styles.agentSection}>
        <h3 style={styles.sectionTitle}>Current Selection</h3>
        <div style={styles.selectionInfo}>
          <div><strong>Selected:</strong> {agents.selected || '(default)'}</div>
          <div><strong>Default:</strong> {agents.default || '(none)'}</div>
        </div>
        <div style={styles.buttonRow}>
          {agents.available.map(agent => (
            <button
              key={agent.id}
              onClick={() => agents.set(agent.id)}
              style={{
                ...styles.selectButton,
                ...(agents.selected === agent.id ? styles.selectButtonActive : {}),
              }}
            >
              {agent.name || agent.id}
            </button>
          ))}
          <button
            onClick={() => agents.set(null)}
            style={{
              ...styles.selectButton,
              ...(agents.selected === null ? styles.selectButtonActive : {}),
            }}
          >
            Reset to Default
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MultiAgentPage() {
  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Multi-Agent</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          Configure multiple AI agents on the server and let users switch between them.
          Each agent can use a different model, system prompt, or behavior. The{' '}
          <code style={docStyles.code}>visibleAgentIds</code> prop controls which agents
          are available to the current user.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Server Configuration</h2>
        <CollapsibleCode>
{`import { UseAIServer, AISDKAgent } from '@meetsmore-oss/use-ai-server';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

new UseAIServer({
  agents: {
    claude: new AISDKAgent({
      name: 'Claude',
      hooks: { loadConfig: () => ({ model: anthropic('claude-opus-5') }) },
    }),
    gpt: new AISDKAgent({
      name: 'GPT-4o',
      hooks: { loadConfig: () => ({ model: openai('gpt-4o') }) },
    }),
  },
  defaultAgent: 'claude',
});`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Client Usage</h2>
        <CollapsibleCode>
{`// Filter which agents are visible
<UseAIProvider
  serverUrl="ws://localhost:8081"
  visibleAgentIds={['claude', 'gpt']}
>

// Programmatic agent switching
const { agents } = useAIContext();

console.log(agents.available);  // [{ id: 'claude', name: 'Claude' }, ...]
console.log(agents.selected);   // 'claude' | null
console.log(agents.default);    // 'claude'

agents.set('gpt');     // Switch to GPT
agents.set(null);      // Reset to default

// Or use the dedicated hook
import { useAgentSelection } from '@meetsmore-oss/use-ai-client';
const { availableAgents, selectedAgent, setAgent } = useAgentSelection();`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.contextCard}>
        <h2 style={docStyles.subtitle}>Agent Selector UI</h2>
        <p style={docStyles.text}>
          When multiple agents are available, a dropdown selector automatically appears
          in the chat header. Users can switch agents between conversations. The selector
          is hidden when only one agent is configured.
        </p>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          This shows the current agent configuration. If the server has multiple agents
          configured, you can switch between them.
        </p>
        <AgentInfo />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  agentPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  agentSection: {},
  sectionTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '8px',
    marginTop: 0,
  },
  emptyState: {
    color: '#9ca3af',
    fontStyle: 'italic',
    fontSize: '13px',
    margin: 0,
  },
  agentItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 14px',
    background: '#f9fafb',
    borderRadius: '6px',
    marginBottom: '6px',
    border: '1px solid #e5e7eb',
  },
  agentItemActive: {
    background: '#f0f7ff',
    borderColor: '#3b82f6',
  },
  agentName: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#1f2937',
  },
  agentId: {
    fontSize: '12px',
    color: '#9ca3af',
    fontFamily: 'monospace',
  },
  defaultBadge: {
    fontSize: '11px',
    fontWeight: '500',
    background: '#dbeafe',
    color: '#1d4ed8',
    padding: '2px 8px',
    borderRadius: '10px',
    marginLeft: 'auto',
  },
  selectionInfo: {
    padding: '12px',
    background: '#f9fafb',
    borderRadius: '6px',
    fontSize: '13px',
    color: '#374151',
    lineHeight: '1.8',
    marginBottom: '12px',
  },
  buttonRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  selectButton: {
    padding: '6px 14px',
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
  },
  selectButtonActive: {
    background: '#3b82f6',
    borderColor: '#3b82f6',
    color: 'white',
  },
};
