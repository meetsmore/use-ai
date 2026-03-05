import React from 'react';
import { useAI, defineTool } from '@meetsmore-oss/use-ai-client';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

function ComponentA() {
  useAI({
    tools: {
      componentAAction: defineTool(
        'Perform an action from Component A',
        () => ({ success: true, source: 'Component A' })
      ),
    },
    prompt: 'Component A is mounted',
    suggestions: [
      'Help me organize my tasks',
      'What can Component A do?',
    ],
  });

  return (
    <div style={styles.component}>
      <strong>Component A</strong> — 2 suggestions registered
    </div>
  );
}

function ComponentB() {
  useAI({
    tools: {
      componentBAction: defineTool(
        'Perform an action from Component B',
        () => ({ success: true, source: 'Component B' })
      ),
    },
    prompt: 'Component B is mounted',
    suggestions: [
      'Calculate something for me',
      'Show me Component B features',
    ],
  });

  return (
    <div style={styles.component}>
      <strong>Component B</strong> — 2 suggestions registered
    </div>
  );
}

function ComponentC() {
  useAI({
    tools: {
      componentCAction: defineTool(
        'Perform an action from Component C',
        () => ({ success: true, source: 'Component C' })
      ),
    },
    prompt: 'Component C is mounted',
    suggestions: [
      'Navigate to the todo page',
    ],
  });

  return (
    <div style={styles.component}>
      <strong>Component C</strong> — 1 suggestion registered
    </div>
  );
}

export default function SuggestionsPage() {
  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Suggestions</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          Each <code style={docStyles.code}>useAI</code> hook can declare{' '}
          <code style={docStyles.code}>suggestions</code> — short prompt texts shown as
          clickable chips in the empty chat state. Suggestions from all mounted components
          are aggregated, and up to 4 are randomly selected for display.
        </p>
        <p style={docStyles.text}>
          Clicking a suggestion sends it as a message. Suggestions disappear once a
          conversation starts and reappear when a new chat is opened.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Code Example</h2>
        <CollapsibleCode>
{`function TodoList() {
  useAI({
    tools: { addTodo, deleteTodo },
    prompt: \`Todos: \${JSON.stringify(todos)}\`,
    suggestions: [
      'Add a todo to buy groceries',
      'Create a shopping list for dinner',
    ],
  });
}

function Calculator() {
  useAI({
    tools: { calculate },
    prompt: \`Result: \${result}\`,
    suggestions: [
      "What's 17 x 410?",
    ],
  });
}

// When both are mounted, up to 4 of the 3 total suggestions
// are randomly shown in the empty chat state.`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          Three components below each register suggestions. Open a <strong>new chat</strong> (click
          the "+" button in the chat panel) to see them aggregated in the empty state.
        </p>
        <div style={styles.componentGrid}>
          <ComponentA />
          <ComponentB />
          <ComponentC />
        </div>
        <p style={{ ...docStyles.text, marginTop: '12px', fontStyle: 'italic' }}>
          Total: 5 suggestions from 3 components. Up to 4 will be randomly shown.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  componentGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  component: {
    padding: '12px 16px',
    background: '#f9fafb',
    borderRadius: '6px',
    fontSize: '13px',
    color: '#374151',
    border: '1px solid #e5e7eb',
  },
};
