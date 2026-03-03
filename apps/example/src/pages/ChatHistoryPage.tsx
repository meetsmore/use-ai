import React, { useState } from 'react';
import { useAIContext } from '@meetsmore-oss/use-ai-client';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

export default function ChatHistoryPage() {
  const { chat } = useAIContext();
  const [chatList, setChatList] = useState<Array<{ id: string; title?: string; createdAt: Date }>>([]);
  const [currentChat, setCurrentChat] = useState<{ id: string; metadata?: Record<string, unknown> } | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  const refreshList = async () => {
    const chats = await chat.list();
    setChatList(chats);
    setStatusMessage(`Found ${chats.length} chat(s)`);
  };

  const handleCreateChat = async () => {
    const id = await chat.create({ title: 'Demo Chat', metadata: { source: 'chat-history-page' } });
    setStatusMessage(`Created chat: ${id}`);
    await refreshList();
  };

  const handleLoadChat = async (chatId: string) => {
    await chat.load(chatId);
    const loaded = await chat.get();
    setCurrentChat(loaded ? { id: loaded.id, metadata: loaded.metadata } : null);
    setStatusMessage(`Loaded chat: ${chatId}`);
  };

  const handleDeleteChat = async (chatId: string) => {
    await chat.delete(chatId);
    setStatusMessage(`Deleted chat: ${chatId}`);
    await refreshList();
  };

  const handleUpdateMetadata = async () => {
    await chat.updateMetadata({ lastViewed: new Date().toISOString(), demo: true });
    const updated = await chat.get();
    setCurrentChat(updated ? { id: updated.id, metadata: updated.metadata } : null);
    setStatusMessage('Metadata updated');
  };

  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Chat History</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          Chat history is persisted to localStorage by default (up to 20 most recent chats).
          Titles are auto-generated from the first user message. Implement the{' '}
          <code style={docStyles.code}>ChatRepository</code> interface for custom storage
          backends (e.g., server-side database).
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Chat Management API</h2>
        <CollapsibleCode>
{`const { chat } = useAIContext();

// List all chats
const chats = await chat.list();

// Create a new chat with optional metadata
const id = await chat.create({ title: 'My Chat', metadata: { source: 'app' } });

// Load a chat (restores messages in the chat panel)
await chat.load(chatId);

// Get the current chat (with messages and metadata)
const current = await chat.get();

// Update metadata on the current chat
await chat.updateMetadata({ processed: true });

// Delete a specific chat
await chat.delete(chatId);

// Clear the current chat (start fresh)
await chat.clear();`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Custom Storage Backend</h2>
        <CollapsibleCode>
{`import type { ChatRepository } from '@meetsmore-oss/use-ai-client';

const myRepository: ChatRepository = {
  async createChat(options) { /* ... */ },
  async loadChat(id) { /* ... */ },
  async saveChat(chat) { /* ... */ },
  async deleteChat(id) { /* ... */ },
  async listChats(options) { /* ... */ },
  async deleteAll() { /* ... */ },
  async updateMetadata(id, metadata, overwrite) { /* ... */ },
};

<UseAIProvider chatRepository={myRepository} serverUrl="...">
  <App />
</UseAIProvider>`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          Use these buttons to manage chats programmatically. The chat panel
          reflects the current state.
        </p>
        <div style={styles.buttonRow}>
          <button onClick={refreshList} style={styles.button}>List Chats</button>
          <button onClick={handleCreateChat} style={styles.buttonPrimary}>Create Chat</button>
          <button onClick={handleUpdateMetadata} style={styles.button}>Update Metadata</button>
        </div>

        {statusMessage && (
          <div style={styles.statusMessage}>{statusMessage}</div>
        )}

        {chatList.length > 0 && (
          <div style={styles.chatList}>
            <h3 style={styles.listTitle}>Chats ({chatList.length})</h3>
            {chatList.map(c => (
              <div key={c.id} style={styles.chatItem}>
                <div style={styles.chatInfo}>
                  <span style={styles.chatTitle}>{c.title || 'Untitled'}</span>
                  <span style={styles.chatId}>{c.id.substring(0, 8)}...</span>
                </div>
                <div style={styles.chatActions}>
                  <button onClick={() => handleLoadChat(c.id)} style={styles.smallButton}>Load</button>
                  <button onClick={() => handleDeleteChat(c.id)} style={styles.smallButtonDanger}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {currentChat && (
          <div style={styles.metadataBox}>
            <h3 style={styles.listTitle}>Current Chat Metadata</h3>
            <pre style={styles.metadataPre}>
              {JSON.stringify(currentChat.metadata || {}, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  buttonRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '12px',
    flexWrap: 'wrap',
  },
  button: {
    padding: '8px 16px',
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
  },
  buttonPrimary: {
    padding: '8px 16px',
    background: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
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
  chatList: {
    marginTop: '8px',
  },
  listTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '8px',
    marginTop: 0,
  },
  chatItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    background: '#f9fafb',
    borderRadius: '6px',
    marginBottom: '6px',
  },
  chatInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  chatTitle: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#1f2937',
  },
  chatId: {
    fontSize: '11px',
    color: '#9ca3af',
    fontFamily: 'monospace',
  },
  chatActions: {
    display: 'flex',
    gap: '6px',
  },
  smallButton: {
    padding: '4px 10px',
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  smallButtonDanger: {
    padding: '4px 10px',
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#dc2626',
  },
  metadataBox: {
    marginTop: '12px',
    padding: '12px',
    background: '#f9fafb',
    borderRadius: '6px',
  },
  metadataPre: {
    margin: 0,
    fontSize: '12px',
    fontFamily: 'monospace',
    color: '#374151',
    whiteSpace: 'pre-wrap',
  },
};
