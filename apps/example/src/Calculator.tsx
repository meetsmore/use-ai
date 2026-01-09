import React, { useState } from 'react';
import { useAI } from '@meetsmore-oss/use-ai-client';
import { useCalculatorLogic } from './useCalculatorLogic';

export default function Calculator() {
  const [input, setInput] = useState('');
  const { result, history, tools, calculate, clearCalculator } = useCalculatorLogic();

  const { ref } = useAI({
    tools,
    prompt: 'Current result: ' + result,
    suggestions: [
      "What's 17 x 410?"
    ]
  });

  const handleCalculate = () => {
    if (!input.trim()) return;
    calculate(input.trim());
  };

  const handleClear = () => {
    clearCalculator();
    setInput('');
  };

  return (
    <div ref={ref} style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Calculator</h1>
        <p style={styles.subtitle}>
          Enter calculations below or ask the AI to perform calculations for you
        </p>

        <div style={styles.display}>
          {result !== null ? result : '0'}
        </div>

        <div style={styles.inputGroup}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleCalculate()}
            placeholder="Enter calculation (e.g., 2 + 2)"
            style={styles.input}
          />
          <button onClick={handleCalculate} style={styles.button}>
            Calculate
          </button>
          <button onClick={handleClear} style={styles.clearButton}>
            Clear
          </button>
        </div>

        {history.length > 0 && (
          <div style={styles.historySection}>
            <h3 style={styles.historyTitle}>History</h3>
            <ul style={styles.historyList}>
              {history.slice().reverse().map((calc) => (
                <li key={calc.timestamp} style={styles.historyItem}>
                  <span style={styles.expression}>{calc.expression}</span>
                  <span style={styles.equals}>=</span>
                  <span style={styles.historyResult}>{calc.result}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {history.length === 0 && (
          <p style={styles.emptyState}>No calculations yet. Try one above!</p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '600px',
    margin: '0 auto',
    padding: '20px',
  },
  card: {
    background: 'white',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    marginBottom: '8px',
    color: '#333',
  },
  subtitle: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '24px',
  },
  display: {
    background: '#f8f9fa',
    border: '2px solid #dee2e6',
    borderRadius: '4px',
    padding: '20px',
    fontSize: '32px',
    fontWeight: 'bold',
    textAlign: 'right',
    marginBottom: '16px',
    color: '#212529',
    fontFamily: 'monospace',
    minHeight: '60px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  inputGroup: {
    display: 'flex',
    gap: '8px',
    marginBottom: '16px',
  },
  input: {
    flex: 1,
    padding: '10px 12px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: 'monospace',
  },
  button: {
    padding: '10px 20px',
    background: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
  clearButton: {
    padding: '10px 20px',
    background: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
  historySection: {
    marginTop: '24px',
  },
  historyTitle: {
    fontSize: '18px',
    fontWeight: 'bold',
    marginBottom: '12px',
    color: '#333',
  },
  historyList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  historyItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    background: '#f8f9fa',
    borderRadius: '4px',
    marginBottom: '8px',
    fontFamily: 'monospace',
    fontSize: '14px',
  },
  expression: {
    color: '#495057',
    flex: 1,
  },
  equals: {
    color: '#6c757d',
  },
  historyResult: {
    color: '#28a745',
    fontWeight: 'bold',
  },
  emptyState: {
    textAlign: 'center',
    color: '#999',
    fontSize: '14px',
    padding: '24px',
  },
};
