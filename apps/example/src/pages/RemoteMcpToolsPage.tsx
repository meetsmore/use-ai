import React, { useState } from 'react';
import { useAI } from '@meetsmore/use-ai-client';

export default function RemoteMcpToolsPage() {
  const [result, setResult] = useState<string>('');

  // Register the page with useAI - no local tools, just relying on remote MCP tools
  useAI({
    tools: {},
    prompt: `Remote MCP Tools Test Page

Current result: ${result}

This page demonstrates remote MCP tools from the MCP server.
The following tools are available remotely from the MCP server:
- mcp_add: Add two numbers together
- mcp_multiply: Multiply two numbers
- mcp_greet: Greet a person by name
- mcp_get_weather: Get weather information for a location
- mcp_get_secure_data: Get secure data (requires authentication via X-API-Key header)

The mcp_get_secure_data tool demonstrates authenticated MCP endpoints using the mcpHeadersProvider feature.
This tool requires the X-API-Key header to be set correctly, which is handled automatically by the UseAIProvider.

You can help the user test these tools by calling them with various inputs.`,
  });

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Remote MCP Tools Test</h1>

      <div style={styles.infoCard}>
        <h2 style={styles.subtitle}>About This Page</h2>
        <p style={styles.text}>
          This page demonstrates remote MCP tool execution. The tools are provided
          by an external NestJS MCP server (running on port 3002) and are
          automatically discovered and made available to the AI.
        </p>
        <p style={styles.text}>
          Try asking the AI to:
        </p>
        <ul style={styles.list}>
          <li>Add two numbers (e.g., "What is 15 plus 27?")</li>
          <li>Multiply numbers (e.g., "Multiply 6 by 8")</li>
          <li>Greet someone (e.g., "Greet Alice")</li>
          <li>Get weather (e.g., "What's the weather in London?")</li>
          <li>Get secure data (e.g., "Get secure data for item-123")</li>
        </ul>
      </div>

      <div style={styles.authCard}>
        <h2 style={styles.subtitle}>Authentication Example</h2>
        <p style={styles.text}>
          The <code style={styles.code}>mcp_get_secure_data</code> tool demonstrates the{' '}
          <code style={styles.code}>mcpHeadersProvider</code> feature.
        </p>
        <p style={styles.text}>
          This tool requires an <code style={styles.code}>X-API-Key</code> header to authenticate.
          The header is automatically provided by the <code style={styles.code}>UseAIProvider</code>{' '}
          which is configured in <code style={styles.code}>src/index.tsx</code>.
        </p>
        <div style={styles.codeBlock}>
          <pre style={styles.pre}>
{`mcpHeadersProvider={() => ({
  'http://localhost:3002': {
    headers: { 'X-API-Key': 'secret-api-key-123' },
  },
})}`}
          </pre>
        </div>
        <p style={styles.text}>
          Without this header, the tool would return an "Unauthorized" error.
        </p>
      </div>

      <div style={styles.resultCard}>
        <h2 style={styles.subtitle}>Result Display</h2>
        <div style={styles.resultBox}>
          <input
            type="text"
            value={result}
            onChange={(e) => setResult(e.target.value)}
            placeholder="Results will appear here (you can also type manually)"
            style={styles.input}
          />
        </div>
        <p style={styles.helpText}>
          The AI can update this result by setting it to the output of remote tool calls.
        </p>
      </div>

      <div style={styles.statusCard}>
        <h3 style={styles.subtitle}>MCP Server Status</h3>
        <p style={styles.text}>
          Remote tools are namespaced with "mcp_" prefix to avoid conflicts.
        </p>
        <p style={styles.text}>
          <strong>MCP Server:</strong> http://localhost:3002
        </p>
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
  infoCard: {
    background: 'white',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
  authCard: {
    background: '#f0f9ff',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    border: '1px solid #bfdbfe',
  },
  resultCard: {
    background: 'white',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
  statusCard: {
    background: '#f8f9fa',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #e0e0e0',
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
  resultBox: {
    marginBottom: '12px',
  },
  input: {
    width: '100%',
    padding: '12px',
    fontSize: '14px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    boxSizing: 'border-box',
    fontFamily: 'monospace',
  },
  helpText: {
    fontSize: '12px',
    color: '#999',
    fontStyle: 'italic',
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
};
