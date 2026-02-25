import React from 'react';
import TodoList from '../TodoList';
import Calculator from '../Calculator';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

export default function CombinedPage() {
  return (
    <div style={{ ...docStyles.container, maxWidth: '1200px' }}>
      <h1 style={docStyles.title}>Combined Components</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          Multiple <code style={docStyles.code}>useAI</code> hooks compose automatically on a
          single page. When both TodoList and Calculator are mounted, the AI has access to tools
          from both components simultaneously — no extra configuration required.
        </p>
        <p style={docStyles.text}>
          Each component registers its own tools and provides its own state via{' '}
          <code style={docStyles.code}>prompt</code>. The use-ai client aggregates all registered
          tools and state into a single view for the AI.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Code Example</h2>
        <CollapsibleCode>
{`// TodoList component
useAI({
  tools: { addTodo, deleteTodo, toggleTodo },
  prompt: \`Todos: \${JSON.stringify(todos)}\`,
});

// Calculator component (same page)
useAI({
  tools: { calculate, clear },
  prompt: \`Calculator result: \${result}\`,
});

// Both components mounted → AI sees all tools:
// addTodo, deleteTodo, toggleTodo, calculate, clear`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          Try: "Add a todo to calculate monthly expenses, then compute 1500 + 800 + 350"
        </p>
        <div style={styles.grid}>
          <div style={styles.column}>
            <TodoList />
          </div>
          <div style={styles.column}>
            <Calculator />
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '24px',
    marginTop: '16px',
  },
  column: {
    minWidth: 0,
  },
};
