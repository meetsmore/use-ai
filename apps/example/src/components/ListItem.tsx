import React, { useState } from 'react';
import { useAI, defineTool } from '@meetsmore-oss/use-ai-client';
import { z } from 'zod';

interface ListItemProps {
  id: string;
  initialLabel: string;
  initialColor: string;
  onDelete?: (itemId: string) => void;
}

export default function ListItem({ id, initialLabel, initialColor, onDelete }: ListItemProps) {
  const [label, setLabel] = useState(initialLabel);
  const [counter, setCounter] = useState(0);
  const [color, setColor] = useState(initialColor);

  const tools = {
    updateLabel: defineTool(
      `Update the label text for ${id}`,
      z.object({
        text: z.string().describe('The new label text')
      }),
      (input) => {
        setLabel(input.text);
        return {
          success: true,
          message: `Updated ${id} label to: ${input.text}`,
          itemId: id
        };
      }
    ),

    setColor: defineTool(
      `Change the background color for ${id}`,
      z.object({
        color: z.string().describe('The new color (e.g., red, blue, #ff0000)')
      }),
      (input) => {
        setColor(input.color);
        return {
          success: true,
          message: `Changed ${id} color to: ${input.color}`,
          itemId: id
        };
      }
    ),

    incrementCounter: defineTool(
      `Increment the counter for ${id}`,
      z.object({
        amount: z.number().optional().describe('Amount to increment by (default: 1)')
      }),
      (input) => {
        const amount = input.amount ?? 1;
        let newValue: number = 0;
        setCounter(prev => {
          newValue = prev + amount;
          return newValue;
        });
        return {
          success: true,
          message: `Incremented ${id} counter by ${amount}`,
          itemId: id,
          newValue
        };
      }
    ),

    decrementCounter: defineTool(
      `Decrement the counter for ${id}`,
      z.object({
        amount: z.number().optional().describe('Amount to decrement by (default: 1)')
      }),
      (input: { amount?: number }) => {
        const amount = input.amount ?? 1;
        let newValue: number = 0;
        setCounter(prev => {
          newValue = prev - amount;
          return newValue;
        });
        return {
          success: true,
          message: `Decremented ${id} counter by ${amount}`,
          itemId: id,
          newValue
        };
      }
    ),

    resetCounter: defineTool(
      `Reset the counter for ${id} to zero`,
      () => {
        setCounter(0);
        return {
          success: true,
          message: `Reset ${id} counter to 0`,
          itemId: id
        };
      }
    ),

    getState: defineTool(
      `Get the current state of ${id}`,
      () => {
        return {
          itemId: id,
          label,
          counter,
          color,
          timestamp: new Date().toISOString()
        };
      }
    ),
  };

  const { ref } = useAI({
    tools,
    prompt: `This is ${id}. Current state - Label: "${label}", Counter: ${counter}, Color: "${color}".`,
  });

  return (
    <div ref={ref} id={id} style={{
      ...styles.container,
      backgroundColor: color,
    }}>
      <div style={styles.header}>
        <h3 style={styles.id}>{id}</h3>
        {onDelete && (
          <button
            onClick={() => onDelete(id)}
            style={styles.deleteButton}
            title="Delete this item"
          >
            ×
          </button>
        )}
      </div>

      <div style={styles.content}>
        <div style={styles.labelContainer}>
          <span style={styles.labelKey}>Label:</span>
          <span style={styles.labelValue}>{label}</span>
        </div>

        <div style={styles.counterContainer}>
          <span style={styles.counterLabel}>Counter:</span>
          <span style={styles.counterValue}>{counter}</span>
        </div>
      </div>

      <div style={styles.manualControls}>
        <button
          onClick={() => setCounter(prev => prev - 1)}
          style={styles.button}
        >
          -
        </button>
        <button
          onClick={() => setCounter(prev => prev + 1)}
          style={styles.button}
        >
          +
        </button>
        <button
          onClick={() => setCounter(0)}
          style={styles.buttonReset}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: '2px solid #ddd',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '12px',
    transition: 'all 0.3s ease',
  },
  header: {
    marginBottom: '12px',
    borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
    paddingBottom: '8px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  id: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
  },
  deleteButton: {
    background: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '50%',
    width: '28px',
    height: '28px',
    cursor: 'pointer',
    fontSize: '20px',
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    lineHeight: '1',
    transition: 'all 0.2s ease',
  },
  content: {
    marginBottom: '12px',
  },
  labelContainer: {
    marginBottom: '8px',
  },
  labelKey: {
    fontWeight: '600',
    marginRight: '8px',
    color: '#555',
  },
  labelValue: {
    color: '#333',
  },
  counterContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  counterLabel: {
    fontWeight: '600',
    color: '#555',
  },
  counterValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#007bff',
  },
  manualControls: {
    display: 'flex',
    gap: '8px',
  },
  button: {
    padding: '6px 12px',
    background: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
  },
  buttonReset: {
    padding: '6px 12px',
    background: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },
};
