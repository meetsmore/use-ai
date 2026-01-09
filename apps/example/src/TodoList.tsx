import React, { useState } from 'react';
import { useAI } from '@meetsmore/use-ai-client';
import { useTodoLogic } from './useTodoLogic';

export default function TodoList() {
  const [input, setInput] = useState('');
  const { todos, tools, addTodo, deleteTodo, toggleTodo } = useTodoLogic();

  const { ref } = useAI({
    tools,
    prompt: `Todo List: ${JSON.stringify(todos)}`,
    suggestions: [
      'Add a todo to buy groceries',
      'Create a shopping list for dinner'
    ],
  });

  const handleAddTodo = () => {
    if (!input.trim()) return;
    addTodo(input.trim());
    setInput('');
  };

  const handleToggleTodo = (id: number) => {
    toggleTodo(id);
  };

  const handleDeleteTodo = (id: number) => {
    deleteTodo(id);
  };

  return (
    <div ref={ref} style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Todo List</h1>
        <p style={styles.subtitle}>
          Click the AI button in the bottom right to manage todos with natural language
        </p>

        <div style={styles.inputGroup}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddTodo()}
            placeholder="Add a new todo..."
            style={styles.input}
          />
          <button onClick={handleAddTodo} style={styles.button}>
            Add
          </button>
        </div>

        <ul style={styles.todoList}>
          {todos.map(todo => (
            <li key={todo.id} style={styles.todoItem}>
              <label style={styles.todoLabel}>
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => handleToggleTodo(todo.id)}
                  style={styles.checkbox}
                />
                <span style={{
                  ...styles.todoText,
                  textDecoration: todo.completed ? 'line-through' : 'none',
                  opacity: todo.completed ? 0.6 : 1,
                }}>
                  {todo.text}
                </span>
              </label>
              <button
                onClick={() => handleDeleteTodo(todo.id)}
                style={styles.deleteButton}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>

        {todos.length === 0 && (
          <p style={styles.emptyState}>No todos yet. Add one above!</p>
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
  },
  button: {
    padding: '10px 20px',
    background: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
  },
  todoList: {
    listStyle: 'none',
  },
  todoItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px',
    borderBottom: '1px solid #eee',
  },
  todoLabel: {
    display: 'flex',
    alignItems: 'center',
    flex: 1,
    cursor: 'pointer',
  },
  checkbox: {
    marginRight: '12px',
    cursor: 'pointer',
  },
  todoText: {
    fontSize: '14px',
    color: '#333',
  },
  deleteButton: {
    padding: '6px 12px',
    background: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  emptyState: {
    textAlign: 'center',
    color: '#999',
    fontSize: '14px',
    padding: '24px',
  },
};
