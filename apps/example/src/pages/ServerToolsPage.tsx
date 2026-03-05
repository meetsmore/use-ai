import React from 'react';
import { useAI } from '@meetsmore-oss/use-ai-client';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

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
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Server Tools</h1>

      <div style={docStyles.prerequisiteCard}>
        <h2 style={docStyles.subtitle}>Prerequisites</h2>
        <p style={docStyles.text}>
          The example server tools on this page are gated behind an environment variable.
          To enable them, add the following to your <code style={docStyles.code}>.env</code> file
          and restart the server:
        </p>
        <CollapsibleCode language="bash">
{`ENABLE_EXAMPLE_SERVER_TOOLS=true`}
        </CollapsibleCode>
        <p style={docStyles.text}>
          Without this, the AI will not have access to the{' '}
          <code style={docStyles.code}>getServerTime</code> or{' '}
          <code style={docStyles.code}>addNumbers</code> tools.
        </p>
      </div>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About Server Tools</h2>
        <p style={docStyles.text}>
          Server tools are defined directly in server code using{' '}
          <code style={docStyles.code}>defineServerTool()</code> and execute in the server
          process. Unlike client tools (which round-trip via Socket.IO) or MCP tools
          (which call remote HTTP endpoints), server tools are simple function calls
          with no network overhead.
        </p>
        <p style={docStyles.text}>
          Try asking the AI:
        </p>
        <ul style={docStyles.list}>
          <li>What time is the server reporting?</li>
          <li>What is 123 plus 456?</li>
          <li>Add 1.5 and 2.7</li>
        </ul>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>How They're Defined</h2>
        <p style={docStyles.text}>
          Server tools are passed to <code style={docStyles.code}>UseAIServer</code> via
          the <code style={docStyles.code}>tools</code> config option. Each tool is created
          with <code style={docStyles.code}>defineServerTool()</code>, which accepts a
          description, an optional Zod schema, and an execute function.
        </p>
        <CollapsibleCode>
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
        </CollapsibleCode>
      </div>

      <div style={docStyles.comparisonCard}>
        <h2 style={docStyles.subtitle}>Server vs Client vs MCP Tools</h2>
        <table style={docStyles.table}>
          <thead>
            <tr>
              <th style={docStyles.th}>Type</th>
              <th style={docStyles.th}>Defined In</th>
              <th style={docStyles.th}>Executed In</th>
              <th style={docStyles.th}>Use Case</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={docStyles.td}><strong>Server</strong></td>
              <td style={docStyles.td}>Server config</td>
              <td style={docStyles.td}>Server process</td>
              <td style={docStyles.td}>DB queries, internal APIs, secrets</td>
            </tr>
            <tr>
              <td style={docStyles.tdAlt}><strong>Client</strong></td>
              <td style={docStyles.tdAlt}>React components</td>
              <td style={docStyles.tdAlt}>Browser</td>
              <td style={docStyles.tdAlt}>UI state, DOM manipulation</td>
            </tr>
            <tr>
              <td style={docStyles.td}><strong>MCP</strong></td>
              <td style={docStyles.td}>Remote endpoint</td>
              <td style={docStyles.td}>External service</td>
              <td style={docStyles.td}>Third-party integrations</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={docStyles.annotationsCard}>
        <h2 style={docStyles.subtitle}>Tool Annotations</h2>
        <p style={docStyles.text}>
          Server tools support the same{' '}
          <code style={docStyles.code}>annotations</code> as client and MCP tools.
          Both example tools use <code style={docStyles.code}>readOnlyHint: true</code>{' '}
          since they don't modify any state. Tools with{' '}
          <code style={docStyles.code}>destructiveHint: true</code> would require
          user approval before execution.
        </p>
      </div>

      <div style={docStyles.contextCard}>
        <h2 style={docStyles.subtitle}>Execution Context</h2>
        <p style={docStyles.text}>
          Server tool execute functions receive a{' '}
          <code style={docStyles.code}>ServerToolContext</code> with access to the
          current session, app state, run ID, and tool call ID. This enables
          tools to read client state or make session-aware decisions.
        </p>
        <CollapsibleCode>
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
        </CollapsibleCode>
      </div>
    </div>
  );
}
