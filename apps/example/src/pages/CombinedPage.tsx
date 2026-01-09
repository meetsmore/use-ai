import React from 'react';
import TodoList from '../TodoList';
import Calculator from '../Calculator';

export default function CombinedPage() {
  return (
    <div style={styles.container}>
      <div style={styles.pageHeader}>
        <h1 style={styles.pageTitle}>Combined Page</h1>
        <p style={styles.pageSubtitle}>
          Both todo and calculator tools are available to the AI on this page
        </p>
      </div>
      <div style={styles.grid}>
        <div style={styles.column}>
          <TodoList />
        </div>
        <div style={styles.column}>
          <Calculator />
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '20px',
  },
  pageHeader: {
    textAlign: 'center',
    marginBottom: '32px',
  },
  pageTitle: {
    fontSize: '36px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
  },
  pageSubtitle: {
    fontSize: '16px',
    color: '#666',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '24px',
  },
  column: {
    minWidth: 0,
  },
};
