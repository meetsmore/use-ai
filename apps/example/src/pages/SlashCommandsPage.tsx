import React, { useState, useEffect } from 'react';
import { useAIContext } from '@meetsmore-oss/use-ai-client';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

export default function SlashCommandsPage() {
  const { commands } = useAIContext();
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    commands.refresh();
  }, []);

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) return;
    try {
      await commands.save(name.trim(), content.trim());
      setStatusMessage(`Saved command: /${name.trim()}`);
      setName('');
      setContent('');
      await commands.refresh();
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDelete = async (id: string, cmdName: string) => {
    await commands.delete(id);
    setStatusMessage(`Deleted command: /${cmdName}`);
    await commands.refresh();
  };

  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Slash Commands</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          Type <code style={docStyles.code}>/</code> in the chat input to trigger the command
          autocomplete menu. Slash commands insert predefined text into the message, making it
          easy to reuse common prompts. Commands are persisted to localStorage by default.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Code Example</h2>
        <CollapsibleCode>
{`const { commands } = useAIContext();

// Save a new command
await commands.save('summarize', 'Summarize the current page content in 3 bullet points');

// List all commands
console.log(commands.list);
// -> [{ id: '...', name: 'summarize', text: '...', createdAt: Date }]

// Delete a command
await commands.delete(commandId);

// Custom storage backend
import type { CommandRepository } from '@meetsmore-oss/use-ai-client';

<UseAIProvider commandRepository={myRepo} serverUrl="...">
  <App />
</UseAIProvider>`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.contextCard}>
        <h2 style={docStyles.subtitle}>How It Works</h2>
        <ul style={docStyles.list}>
          <li>Type <code style={docStyles.code}>/</code> at the start of a message to open the autocomplete</li>
          <li>Continue typing to filter commands by name</li>
          <li>Click a command or press Enter to insert its text</li>
          <li>Commands are saved per-browser (localStorage) by default</li>
          <li>Pass a <code style={docStyles.code}>commandRepository</code> prop to use custom storage</li>
        </ul>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          Create commands below, then try typing <code style={docStyles.code}>/</code> in
          the chat input to use them.
        </p>

        <div style={styles.form}>
          <div style={styles.inputRow}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Command Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. summarize"
                style={styles.input}
              />
            </div>
            <div style={{ ...styles.inputGroup, flex: 2 }}>
              <label style={styles.label}>Content</label>
              <input
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="e.g. Summarize the current page in 3 bullet points"
                style={styles.input}
              />
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !content.trim()}
            style={{
              ...styles.saveButton,
              ...(!name.trim() || !content.trim() ? styles.disabled : {}),
            }}
          >
            Save Command
          </button>
        </div>

        {statusMessage && (
          <div style={styles.statusMessage}>{statusMessage}</div>
        )}

        {commands.list.length > 0 && (
          <div style={styles.commandList}>
            <h3 style={styles.listTitle}>Saved Commands ({commands.list.length})</h3>
            {commands.list.map(cmd => (
              <div key={cmd.id} style={styles.commandItem}>
                <div style={styles.commandInfo}>
                  <code style={styles.commandName}>/{cmd.name}</code>
                  <span style={styles.commandText}>{cmd.text}</span>
                </div>
                <button onClick={() => handleDelete(cmd.id, cmd.name)} style={styles.deleteButton}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        {commands.list.length === 0 && (
          <p style={styles.emptyState}>
            No saved commands yet. Create one above, then type / in the chat input.
          </p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: {
    marginBottom: '16px',
  },
  inputRow: {
    display: 'flex',
    gap: '12px',
    marginBottom: '12px',
  },
  inputGroup: {
    flex: 1,
  },
  label: {
    display: 'block',
    fontSize: '12px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '4px',
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    fontSize: '13px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  saveButton: {
    padding: '8px 20px',
    background: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  statusMessage: {
    padding: '8px 12px',
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '6px',
    fontSize: '13px',
    color: '#166534',
    marginBottom: '12px',
  },
  commandList: {
    marginTop: '12px',
  },
  listTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '8px',
    marginTop: 0,
  },
  commandItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    background: '#f9fafb',
    borderRadius: '6px',
    marginBottom: '6px',
  },
  commandInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flex: 1,
    marginRight: '12px',
  },
  commandName: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#3b82f6',
    fontFamily: 'monospace',
  },
  commandText: {
    fontSize: '12px',
    color: '#6b7280',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '400px',
  },
  deleteButton: {
    padding: '4px 10px',
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#dc2626',
  },
  emptyState: {
    textAlign: 'center',
    color: '#9ca3af',
    fontStyle: 'italic',
    fontSize: '13px',
    padding: '24px',
    margin: 0,
  },
};
