import React, { useState } from 'react';
import { useAI, defineTool } from '@meetsmore-oss/use-ai-client';
import { z } from 'zod';
import ListItem from '../components/ListItem';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

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
      },
      { annotations: { title: 'Deleting Item', destructiveHint: true } }
    ),
  };

  const { ref } = useAI({
    tools,
    prompt: `This is the Multi-List Page. Current items: ${items.map(item => item.id).join(', ')}. Total items: ${items.length}.`,
    invisible: true,
  });

  return (
    <div ref={ref} style={docStyles.container}>
      <h1 style={docStyles.title}>Multiple Instances</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          The <code style={docStyles.code}>id</code> parameter differentiates multiple instances
          of the same component. Each list item below has its own{' '}
          <code style={docStyles.code}>useAI</code> hook with tools. The{' '}
          <code style={docStyles.code}>id</code> prefixes tool names so the AI can target
          specific items (e.g., <code style={docStyles.code}>Item-A/updateLabel</code>).
        </p>
        <p style={docStyles.text}>
          Creating and deleting items dynamically registers and deregisters tools mid-run —
          the AI immediately sees new tools when components mount.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Code Example</h2>
        <CollapsibleCode>
{`function ListItem({ id }: { id: string }) {
  const [label, setLabel] = useState('...');
  const [counter, setCounter] = useState(0);

  const tools = {
    updateLabel: defineTool(
      \`Change the label of \${id}\`,
      z.object({ label: z.string() }),
      (input) => { setLabel(input.label); return { success: true }; }
    ),
    incrementCounter: defineTool(
      \`Increment \${id}'s counter\`,
      () => { setCounter(c => c + 1); return { success: true }; }
    ),
  };

  useAI({
    tools,
    prompt: \`\${id}: label="\${label}", counter=\${counter}\`,
    id,  // Prefixes tool names: "Item-A/updateLabel"
  });

  return (/* item UI */);
}`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          Try: "Change the label of Item-A to Hello World" or "Increment all counters" or "Create a new item"
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
