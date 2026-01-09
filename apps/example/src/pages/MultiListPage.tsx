import React, { useState } from 'react';
import { useAI, defineTool } from '@meetsmore/use-ai-client';
import { z } from 'zod';
import ListItem from '../components/ListItem';

interface Item {
  id: string;
  initialLabel: string;
  initialColor: string;
}

export default function MultiListPage() {
  const [items, setItems] = useState<Item[]>([
    { id: 'Item-A', initialLabel: 'First Item', initialColor: '#ffebee' },
    { id: 'Item-B', initialLabel: 'Second Item', initialColor: '#e3f2fd' },
    { id: 'Item-C', initialLabel: 'Third Item', initialColor: '#e8f5e9' },
    { id: 'Item-D', initialLabel: 'Fourth Item', initialColor: '#fff3e0' },
  ]);

  const handleDeleteItem = (itemId: string) => {
    setItems(prevItems => prevItems.filter(item => item.id !== itemId));
  };

  const handleCreateItem = () => {
    const nextLetter = String.fromCharCode(65 + items.length); // A, B, C, D, E, ...
    const colors = ['#ffebee', '#e3f2fd', '#e8f5e9', '#fff3e0', '#f3e5f5', '#fce4ec'];
    const newItem: Item = {
      id: `Item-${nextLetter}`,
      initialLabel: `New Item ${nextLetter}`,
      initialColor: colors[items.length % colors.length],
    };
    setItems(prevItems => [...prevItems, newItem]);
  };

  const tools = {
    createNewItem: defineTool(
      'Create a new list item with specified properties',
      z.object({
        label: z.string().describe('The label for the new item'),
        color: z.string().optional().describe('The background color for the new item (optional)'),
      }),
      (input) => {
        const nextLetter = String.fromCharCode(65 + items.length);
        const defaultColors = ['#ffebee', '#e3f2fd', '#e8f5e9', '#fff3e0', '#f3e5f5', '#fce4ec'];
        const newItem: Item = {
          id: `Item-${nextLetter}`,
          initialLabel: input.label,
          initialColor: input.color || defaultColors[items.length % defaultColors.length],
        };
        setItems(prevItems => [...prevItems, newItem]);
        return {
          success: true,
          message: `Created new item ${newItem.id}`,
          itemId: newItem.id,
        };
      }
    ),

    deleteItem: defineTool(
      'Delete a specific list item',
      z.object({
        itemId: z.string().describe('The ID of the item to delete (e.g., Item-A)'),
      }),
      (input) => {
        const itemExists = items.some(item => item.id === input.itemId);
        if (!itemExists) {
          return {
            success: false,
            message: `Item ${input.itemId} not found`,
          };
        }
        setItems(prevItems => prevItems.filter(item => item.id !== input.itemId));
        return {
          success: true,
          message: `Deleted item ${input.itemId}`,
        };
      }
    ),
  };

  const { ref } = useAI({
    tools,
    prompt: `This is the Multi-List Page. Current items: ${items.map(item => item.id).join(', ')}. Total items: ${items.length}.`,
    invisible: true,
  });

  return (
    <div ref={ref} style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Multiple List Items Test</h1>
        <p style={styles.subtitle}>
          Each item below has its own useAI hook with tools. Try asking the AI to:
        </p>
        <ul style={styles.instructions}>
          <li>Change the label of Item-A</li>
          <li>Increment the counter on all items</li>
          <li>Change Item-B's color to blue</li>
          <li>Get the state of all items</li>
          <li>Reset counters for items A and C</li>
          <li><strong>Create a new item</strong> (tests dynamic tool registration)</li>
          <li><strong>Delete Item-C</strong> (tests tool deregistration)</li>
        </ul>
        <p style={styles.note}>
          <strong>Note:</strong> This page tests what happens when multiple components
          with similar tools are mounted. Each list item registers its own set of tools
          with unique descriptions that include the item ID. You can also create and delete
          items to test that tools are immediately available when components mount.
        </p>

        <div style={styles.createButtonContainer}>
          <button onClick={handleCreateItem} style={styles.createButton}>
            + Create New Item
          </button>
        </div>

        <div style={styles.itemsContainer}>
          {items.map(item => (
            <ListItem
              key={item.id}
              id={item.id}
              initialLabel={item.initialLabel}
              initialColor={item.initialColor}
              onDelete={handleDeleteItem}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '900px',
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
    marginBottom: '12px',
  },
  instructions: {
    fontSize: '14px',
    color: '#555',
    marginBottom: '16px',
    paddingLeft: '20px',
  },
  note: {
    fontSize: '13px',
    color: '#666',
    padding: '12px',
    background: '#f8f9fa',
    borderRadius: '4px',
    marginBottom: '24px',
    borderLeft: '3px solid #007bff',
  },
  createButtonContainer: {
    marginBottom: '20px',
    display: 'flex',
    justifyContent: 'center',
  },
  createButton: {
    padding: '10px 20px',
    background: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: '600',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    transition: 'all 0.2s ease',
  },
  itemsContainer: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '16px',
  },
};
