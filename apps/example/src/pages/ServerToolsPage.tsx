import React from 'react';
import { useAI } from '@meetsmore-oss/use-ai-client';

export default function ServerToolsPage() {
  useAI({
    tools: {},
    prompt: `Server Tools Demo Page

This page demonstrates server-side tools that execute directly in the server process.
The following server tools are available:
- getServerTime: Get the current server time as an ISO 8601 timestamp (no parameters)
- addNumbers: Add two numbers together (parameters: a, b)

These tools run server-side with no client round-trip. Help the user test them.`,
  });

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Server Tools Demo</h1>

      <div style={styles.prerequisiteCard}>
        <h2 style={styles.subtitle}>Prerequisites</h2>
        <p style={styles.text}>
          The example server tools on this page are gated behind an environment variable.
          To enable them, add the following to your <code style={styles.code}>.env</code> file
          and restart the server:
        </p>
        <div style={styles.codeBlock}>
          <pre style={styles.pre}>ENABLE_EXAMPLE_SERVER_TOOLS=true</pre>
        </div>
        <p style={styles.text}>
          Without this, the AI will not have access to the{' '}
          <code style={styles.code}>getServerTime</code> or{' '}
          <code style={styles.code}>addNumbers</code> tools.
        </p>
      </div>

      <div style={styles.infoCard}>
        <h2 style={styles.subtitle}>About Server Tools</h2>
        <p style={styles.text}>
          Server tools are defined directly in server code using{' '}
          <code style={styles.code}>defineServerTool()</code> and execute in the server
          process. Unlike client tools (which round-trip via Socket.IO) or MCP tools
          (which call remote HTTP endpoints), server tools are simple function calls
          with no network overhead.
        </p>
        <p style={styles.text}>
          Try asking the AI:
        </p>
        <ul style={styles.list}>
          <li>What time is the server reporting?</li>
          <li>What is 123 plus 456?</li>
          <li>Add 1.5 and 2.7</li>
        </ul>
      </div>

      <div style={styles.definitionCard}>
        <h2 style={styles.subtitle}>How They're Defined</h2>
        <p style={styles.text}>
          Server tools are passed to <code style={styles.code}>UseAIServer</code> via
          the <code style={styles.code}>tools</code> config option. Each tool is created
          with <code style={styles.code}>defineServerTool()</code>, which accepts a
          description, an optional Zod schema, and an execute function.
        </p>
        <div style={styles.codeBlock}>
          <pre style={styles.pre}>
{`import { UseAIServer, defineServerTool } from '@meetsmore-oss/use-ai-server';
import { z } from 'zod';

new UseAIServer({
  agents: { /* ... */ },
  defaultAgent: 'claude',
  tools: {
    getServerTime: defineServerTool(
      'Get the current server time',
      async () => new Date().toISOString()
    ),
    addNumbers: defineServerTool(
      'Add two numbers together',
      z.object({
        a: z.number(),
        b: z.number(),
      }),
      async ({ a, b }) => ({ result: a + b })
    ),
  },
});`}
          </pre>
        </div>
      </div>

      <div style={styles.comparisonCard}>
        <h2 style={styles.subtitle}>Server vs Client vs MCP Tools</h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Type</th>
              <th style={styles.th}>Defined In</th>
              <th style={styles.th}>Executed In</th>
              <th style={styles.th}>Use Case</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={styles.td}><strong>Server</strong></td>
              <td style={styles.td}>Server config</td>
              <td style={styles.td}>Server process</td>
              <td style={styles.td}>DB queries, internal APIs, secrets</td>
            </tr>
            <tr>
              <td style={{ ...styles.td, background: '#f9fafb' }}><strong>Client</strong></td>
              <td style={{ ...styles.td, background: '#f9fafb' }}>React components</td>
              <td style={{ ...styles.td, background: '#f9fafb' }}>Browser</td>
              <td style={{ ...styles.td, background: '#f9fafb' }}>UI state, DOM manipulation</td>
            </tr>
            <tr>
              <td style={styles.td}><strong>MCP</strong></td>
              <td style={styles.td}>Remote endpoint</td>
              <td style={styles.td}>External service</td>
              <td style={styles.td}>Third-party integrations</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={styles.annotationsCard}>
        <h2 style={styles.subtitle}>Tool Annotations</h2>
        <p style={styles.text}>
          Server tools support the same{' '}
          <code style={styles.code}>annotations</code> as client and MCP tools.
          Both example tools use <code style={styles.code}>readOnlyHint: true</code>{' '}
          since they don't modify any state. Tools with{' '}
          <code style={styles.code}>destructiveHint: true</code> would require
          user approval before execution.
        </p>
      </div>

      <div style={styles.contextCard}>
        <h2 style={styles.subtitle}>Execution Context</h2>
        <p style={styles.text}>
          Server tool execute functions receive a{' '}
          <code style={styles.code}>ServerToolContext</code> with access to the
          current session, app state, run ID, and tool call ID. This enables
          tools to read client state or make session-aware decisions.
        </p>
        <div style={styles.codeBlock}>
          <pre style={styles.pre}>
{`defineServerTool(
  'Get user-specific data',
  z.object({ key: z.string() }),
  async ({ key }, context) => {
    // context.session - current client session
    // context.state   - latest app state from client
    // context.runId   - current agent run ID
    // context.toolCallId - this tool call's ID
    return db.get(key);
  }
);`}
          </pre>
        </div>
      </div>
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
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '24px',
  },
  subtitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#444',
    marginBottom: '12px',
  },
  prerequisiteCard: {
    background: '#fef2f2',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    border: '1px solid #fca5a5',
  },
  infoCard: {
    background: 'white',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
  definitionCard: {
    background: '#f0fdf4',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    border: '1px solid #bbf7d0',
  },
  comparisonCard: {
    background: 'white',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
  annotationsCard: {
    background: '#fefce8',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    border: '1px solid #fde047',
  },
  contextCard: {
    background: '#f0f9ff',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    border: '1px solid #bfdbfe',
  },
  text: {
    fontSize: '14px',
    color: '#666',
    lineHeight: '1.6',
    marginBottom: '8px',
  },
  list: {
    fontSize: '14px',
    color: '#666',
    lineHeight: '1.8',
    paddingLeft: '20px',
  },
  code: {
    background: '#e5e7eb',
    padding: '2px 6px',
    borderRadius: '3px',
    fontSize: '13px',
    fontFamily: 'monospace',
    color: '#1f2937',
  },
  codeBlock: {
    background: '#1f2937',
    borderRadius: '6px',
    padding: '16px',
    marginTop: '12px',
    marginBottom: '12px',
    overflow: 'auto',
  },
  pre: {
    margin: 0,
    fontSize: '13px',
    color: '#e5e7eb',
    fontFamily: 'monospace',
    lineHeight: '1.5',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '14px',
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: '2px solid #e5e7eb',
    color: '#374151',
    fontWeight: '600',
  },
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid #e5e7eb',
    color: '#666',
  },
};
