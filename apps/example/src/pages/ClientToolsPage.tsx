import React, { useState } from 'react';
import { useAI, defineTool } from '@meetsmore-oss/use-ai-client';
import { z } from 'zod';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

export default function ClientToolsPage() {
  const [message, setMessage] = useState('No tool called yet');
  const [counter, setCounter] = useState(0);

  const tools = {
    greet: defineTool(
      'Greet the user with a custom message',
      z.object({
        name: z.string().describe('The name to greet'),
      }),
      (input) => {
        setMessage(`Hello, ${input.name}!`);
        return { success: true, greeting: `Hello, ${input.name}!` };
      },
      { annotations: { title: 'Greeting' } }
    ),

    increment: defineTool(
      'Increment the counter by a specified amount',
      z.object({
        amount: z.number().describe('Amount to increment by').default(1),
      }),
      (input) => {
        setCounter(prev => prev + input.amount);
        return { success: true, newValue: counter + input.amount };
      }
    ),

    reset: defineTool(
      'Reset the counter and message to defaults',
      () => {
        setMessage('No tool called yet');
        setCounter(0);
        return { success: true, message: 'Reset complete' };
      }
    ),

    deleteEverything: defineTool(
      'Permanently delete all data (destructive demo)',
      () => {
        setMessage('Everything deleted!');
        setCounter(0);
        return { success: true };
      },
      { annotations: { destructiveHint: true, title: 'Deleting Everything' } }
    ),
  };

  useAI({
    tools,
    prompt: `Client Tools Demo. Current message: "${message}". Counter: ${counter}.`,
  });

  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Client Tools</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          Client tools are defined in React components using{' '}
          <code style={docStyles.code}>defineTool()</code> and execute in the browser.
          They can read and modify component state, access the DOM, and return values
          that the AI uses to formulate its response.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>With Zod Schema</h2>
        <p style={docStyles.text}>
          Most tools accept parameters defined with a Zod schema. The schema provides
          type safety and automatic validation.
        </p>
        <CollapsibleCode>
{`const greet = defineTool(
  'Greet the user with a custom message',
  z.object({
    name: z.string().describe('The name to greet'),
  }),
  (input) => {
    setMessage(\`Hello, \${input.name}!\`);
    return { success: true, greeting: \`Hello, \${input.name}!\` };
  },
  { annotations: { title: 'Greeting' } }
);`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Without Schema (No Arguments)</h2>
        <p style={docStyles.text}>
          Tools that don't need parameters skip the schema entirely — just pass the
          description and function.
        </p>
        <CollapsibleCode>
{`const reset = defineTool(
  'Reset the counter and message to defaults',
  () => {
    setMessage('No tool called yet');
    setCounter(0);
    return { success: true, message: 'Reset complete' };
  }
);`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.annotationsCard}>
        <h2 style={docStyles.subtitle}>Tool Annotations</h2>
        <p style={docStyles.text}>
          Annotations provide behavioral hints about tools:
        </p>
        <table style={docStyles.table}>
          <thead>
            <tr>
              <th style={docStyles.th}>Annotation</th>
              <th style={docStyles.th}>Effect</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={docStyles.td}><code style={docStyles.code}>destructiveHint: true</code></td>
              <td style={docStyles.td}>Shows approval dialog before execution</td>
            </tr>
            <tr>
              <td style={docStyles.tdAlt}><code style={docStyles.code}>readOnlyHint: true</code></td>
              <td style={docStyles.tdAlt}>Indicates the tool only reads data</td>
            </tr>
            <tr>
              <td style={docStyles.td}><code style={docStyles.code}>idempotentHint: true</code></td>
              <td style={docStyles.td}>Safe to retry without side effects</td>
            </tr>
            <tr>
              <td style={docStyles.tdAlt}><code style={docStyles.code}>title: string</code></td>
              <td style={docStyles.tdAlt}>Display name shown during execution and in approval dialog</td>
            </tr>
          </tbody>
        </table>
        <CollapsibleCode>
{`const deleteAll = defineTool(
  'Permanently delete all data',
  () => { /* ... */ },
  {
    annotations: {
      destructiveHint: true,
      title: 'Deleting Everything',
    },
  }
);`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          Try: "Greet Alice", "Increment the counter by 5", "Reset everything",
          or "Delete everything" (requires approval).
        </p>
        <div style={styles.demoPanel}>
          <div style={styles.demoItem}>
            <span style={styles.demoLabel}>Message:</span>
            <span style={styles.demoValue}>{message}</span>
          </div>
          <div style={styles.demoItem}>
            <span style={styles.demoLabel}>Counter:</span>
            <span style={styles.demoValue}>{counter}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  demoPanel: {
    background: '#f9fafb',
    borderRadius: '8px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  demoItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  demoLabel: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    minWidth: '80px',
  },
  demoValue: {
    fontSize: '14px',
    color: '#666',
    padding: '4px 12px',
    background: 'white',
    borderRadius: '4px',
    border: '1px solid #e5e7eb',
  },
};
