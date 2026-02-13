import React, { useRef, useState } from 'react';
import { useAIContext, type SendMessageOptions } from '@meetsmore-oss/use-ai-client';

export default function ProgrammaticChatPage() {
  const { chat, connected } = useAIContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);

  const handleSendPreset = async (message: string, options?: SendMessageOptions) => {
    if (!connected || isSending) return;
    setIsSending(true);
    try {
      await chat.sendMessage(message, options);
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleSendWithFile = async () => {
    if (!selectedFile || !connected || isSending) return;
    setIsSending(true);
    try {
      await chat.sendMessage('Please analyze this file', { attachments: [selectedFile] });
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Failed to send message with file:', error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Programmatic Chat Demo</h1>
      <p style={styles.description}>
        This page demonstrates how to send messages to the chat panel programmatically using{' '}
        <code style={styles.code}>sendMessage()</code> from <code style={styles.code}>useAIContext()</code>.
      </p>

      <div style={styles.statusBadge} data-testid="connection-status">
        Status: {connected ? (
          <span style={styles.connected} data-testid="status-connected">Connected</span>
        ) : (
          <span style={styles.disconnected} data-testid="status-disconnected">Disconnected</span>
        )}
      </div>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Send Preset Messages</h2>
        <p style={styles.sectionDescription}>
          Click a button to send a preset message to the chat panel.
        </p>
        <div style={styles.buttonGroup}>
          <button
            style={styles.button}
            onClick={() => handleSendPreset('What can you help me with?')}
            disabled={!connected || isSending}
            data-testid="btn-ask-capabilities"
          >
            Ask capabilities
          </button>
          <button
            style={styles.button}
            onClick={() => handleSendPreset('Tell me a joke')}
            disabled={!connected || isSending}
            data-testid="btn-tell-joke"
          >
            Tell a joke
          </button>
          <button
            style={styles.button}
            onClick={() => handleSendPreset('Hello! Starting a fresh conversation.', { newChat: true })}
            disabled={!connected || isSending}
            data-testid="btn-new-chat-greeting"
          >
            New chat + greeting
          </button>
          <button
            style={styles.button}
            onClick={() => handleSendPreset('Process this document as an invoice.', {
              newChat: true,
              metadata: { documentType: 'invoice', priority: 'high' }
            })}
            disabled={!connected || isSending}
            data-testid="btn-new-chat-with-metadata"
          >
            New chat with metadata
          </button>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Send with Attachment</h2>
        <p style={styles.sectionDescription}>
          Select a file and send it with a message asking the AI to analyze it.
        </p>
        <div style={styles.fileSection}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            style={styles.fileInput}
            accept="image/*,application/pdf"
            data-testid="file-input"
          />
          {selectedFile && (
            <div style={styles.fileInfo} data-testid="file-info">
              <span style={styles.fileName} data-testid="file-name">{selectedFile.name}</span>
              <span style={styles.fileSize} data-testid="file-size">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
            </div>
          )}
          <button
            style={{
              ...styles.button,
              ...(selectedFile ? styles.buttonPrimary : {}),
            }}
            onClick={handleSendWithFile}
            disabled={!selectedFile || !connected || isSending}
            data-testid="btn-send-with-file"
          >
            {isSending ? 'Sending...' : 'Send with file'}
          </button>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Code Example</h2>
        <pre style={styles.codeBlock}>
{`import { useAIContext } from '@meetsmore-oss/use-ai-client';

function MyComponent() {
  const { chat } = useAIContext();

  // Simple message
  await chat.sendMessage('Hello, AI!');

  // Start a new chat
  await chat.sendMessage('Fresh start', { newChat: true });

  // New chat with metadata (useful for file transformers)
  await chat.sendMessage('Process this document', {
    newChat: true,
    metadata: { documentType: 'invoice', customerId: '12345' }
  });

  // With file attachment
  await chat.sendMessage('Analyze this', {
    attachments: [file]
  });

  // Don't open chat panel
  await chat.sendMessage('Background task', {
    openChat: false
  });

  // Access/update metadata on current chat
  const currentChat = await chat.get();
  console.log(currentChat?.metadata);

  await chat.updateMetadata({ processed: true });
}`}
        </pre>
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '20px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    marginBottom: '8px',
    color: '#333',
  },
  description: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '24px',
    lineHeight: '1.5',
  },
  code: {
    background: '#f4f4f4',
    padding: '2px 6px',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '14px',
  },
  statusBadge: {
    marginBottom: '24px',
    fontSize: '14px',
  },
  connected: {
    color: '#22c55e',
    fontWeight: 'bold',
  },
  disconnected: {
    color: '#ef4444',
    fontWeight: 'bold',
  },
  section: {
    background: 'white',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '8px',
    color: '#333',
  },
  sectionDescription: {
    fontSize: '14px',
    color: '#666',
    marginBottom: '16px',
  },
  buttonGroup: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  button: {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: '500',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    background: 'white',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  buttonPrimary: {
    background: '#007bff',
    color: 'white',
    borderColor: '#007bff',
  },
  fileSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    alignItems: 'flex-start',
  },
  fileInput: {
    fontSize: '14px',
  },
  fileInfo: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    fontSize: '14px',
  },
  fileName: {
    fontWeight: '500',
    color: '#333',
  },
  fileSize: {
    color: '#666',
  },
  codeBlock: {
    background: '#1e1e1e',
    color: '#d4d4d4',
    padding: '16px',
    borderRadius: '8px',
    overflow: 'auto',
    fontSize: '13px',
    lineHeight: '1.5',
    fontFamily: 'monospace',
  },
};
