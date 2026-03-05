import React from 'react';
import { UseAIProvider, UseAIChat } from '@meetsmore-oss/use-ai-client';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

export default function MultimodalPage() {
  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Multimodal</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          Enable file uploads in chat with the <code style={docStyles.code}>fileUploadConfig</code> prop.
          By default, files are base64-encoded and embedded in the message using{' '}
          <code style={docStyles.code}>EmbedFileUploadBackend</code>. Configure{' '}
          <code style={docStyles.code}>maxFileSize</code>,{' '}
          <code style={docStyles.code}>acceptedTypes</code>, and optional{' '}
          <code style={docStyles.code}>transformers</code> for pre-processing.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Code Example</h2>
        <CollapsibleCode>
{`<UseAIProvider
  serverUrl="ws://localhost:8081"
  fileUploadConfig={{
    maxFileSize: 10 * 1024 * 1024,  // 10 MB
    acceptedTypes: ['image/*', 'application/pdf'],
    // Optional: transform files before sending to AI
    transformers: {
      'application/pdf': {
        async transform(files, context, onProgress) {
          // Convert PDF to text with progress
          return files.map(f => extractText(f));
        },
      },
    },
  }}
>`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.contextCard}>
        <h2 style={docStyles.subtitle}>Configuration Options</h2>
        <table style={docStyles.table}>
          <thead>
            <tr>
              <th style={docStyles.th}>Option</th>
              <th style={docStyles.th}>Default</th>
              <th style={docStyles.th}>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={docStyles.td}><code style={docStyles.code}>maxFileSize</code></td>
              <td style={docStyles.td}>10 MB</td>
              <td style={docStyles.td}>Maximum file size in bytes</td>
            </tr>
            <tr>
              <td style={docStyles.tdAlt}><code style={docStyles.code}>acceptedTypes</code></td>
              <td style={docStyles.tdAlt}><code style={docStyles.code}>['image/*', 'application/pdf']</code></td>
              <td style={docStyles.tdAlt}>MIME patterns for allowed file types</td>
            </tr>
            <tr>
              <td style={docStyles.td}><code style={docStyles.code}>backend</code></td>
              <td style={docStyles.td}>EmbedFileUploadBackend</td>
              <td style={docStyles.td}>Handles file encoding (base64 by default)</td>
            </tr>
            <tr>
              <td style={docStyles.tdAlt}><code style={docStyles.code}>transformers</code></td>
              <td style={docStyles.tdAlt}>none</td>
              <td style={docStyles.tdAlt}>MIME to transformer map for pre-processing</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={docStyles.annotationsCard}>
        <h2 style={docStyles.subtitle}>Disabling File Upload</h2>
        <p style={docStyles.text}>
          To disable file uploads entirely, set{' '}
          <code style={docStyles.code}>{'fileUploadConfig={false}'}</code>. The paperclip
          icon will be hidden from the chat input.
        </p>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          This chat has file uploads enabled. Click the paperclip icon to attach an image
          or PDF, then send it to the AI.
        </p>
        <UseAIProvider
          serverUrl="ws://localhost:8081"
          renderChat={false}
          fileUploadConfig={{
            maxFileSize: 10 * 1024 * 1024,
            acceptedTypes: ['image/*', 'application/pdf'],
          }}
        >
          <div style={styles.chatContainer}>
            <UseAIChat />
          </div>
        </UseAIProvider>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  chatContainer: {
    background: 'white',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    height: '450px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
};
