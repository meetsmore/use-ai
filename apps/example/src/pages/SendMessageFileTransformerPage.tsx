import {
  type FileTransformer,
  UseAIChat,
  UseAIProvider,
  useAIContext,
} from '@meetsmore-oss/use-ai-client'
import React, { useState } from 'react'
import { CollapsibleCode } from '../components/CollapsibleCode'
import { docStyles } from '../styles/docStyles'

const PDF_MOCK_TEXT =
  'This is a mock PDF transcription. The document describes a quarterly sales report with three sections: summary, regional breakdown, and outlook for next quarter.'

/**
 * PDF Transformer - Takes ~3 seconds total, reporting progress in 6 steps.
 * Progress is surfaced in the assistant loading bubble (not the file chip)
 * because the transformer is invoked by chat.sendMessage() at send time.
 */
const pdfTransformer: FileTransformer = {
  async transform(files, _context, onProgress) {
    console.log(`[PDF Transformer] Processing ${files.length} file(s)`)

    const steps = [15, 30, 50, 70, 90, 100]
    for (const progress of steps) {
      await sleep(500)
      onProgress?.(progress)
    }

    return files.map(() => PDF_MOCK_TEXT)
  },
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function Dropzone() {
  const { chat, connected } = useAIContext()
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    setError(null)

    if (!connected) {
      setError('Not connected to the server yet.')
      return
    }

    const files = Array.from(e.dataTransfer.files)
    const pdf = files.find((f) => f.type === 'application/pdf')
    if (!pdf) {
      setError('Please drop a PDF file.')
      return
    }

    try {
      await chat.sendMessage(`Please summarise ${pdf.name}.`, {
        newChat: true,
        attachments: [pdf],
        openChat: true,
      })
    } catch (err) {
      console.error('Failed to send message with file:', err)
      setError(err instanceof Error ? err.message : 'Failed to send message.')
    }
  }

  return (
    <div>
      <div
        data-testid='pdf-dropzone'
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        style={{
          ...styles.dropzone,
          ...(isDragging ? styles.dropzoneActive : {}),
          ...(connected ? {} : styles.dropzoneDisabled),
        }}
      >
        <div style={styles.dropzoneIcon}>PDF</div>
        <div style={styles.dropzoneText}>
          Drop a PDF here to summarise it
        </div>
        <div style={styles.dropzoneHint}>
          Dropping the file calls <code>chat.sendMessage()</code> with the PDF
          as an attachment. Progress appears inside the assistant loading
          bubble.
        </div>
      </div>
      {error && (
        <div style={styles.error} data-testid='dropzone-error'>
          {error}
        </div>
      )}
    </div>
  )
}

export default function SendMessageFileTransformerPage() {
  return (
    <UseAIProvider
      serverUrl='ws://localhost:8081'
      renderChat={false}
      fileUploadConfig={{
        maxFileSize: 10 * 1024 * 1024,
        acceptedTypes: ['application/pdf'],
        transformers: {
          'application/pdf': pdfTransformer,
        },
      }}
    >
      <div style={styles.page}>
        <h2 style={styles.title}>File Transformer via sendMessage</h2>

        <div style={{ ...docStyles.infoCard, marginBottom: '24px' }}>
          <h3 style={docStyles.subtitle}>About</h3>
          <p style={docStyles.text}>
            When a file transformer is triggered by{' '}
            <code style={docStyles.code}>chat.sendMessage()</code> (instead of
            attaching the file via the compose area), progress is rendered
            inside the assistant's <strong>loading message bubble</strong>{' '}
            rather than on a file chip. Drop a PDF into the box below to see
            the difference — the transformer takes about 3 seconds and streams
            progress into the chat.
          </p>
        </div>

        <Dropzone />

        <div style={styles.codeSection}>
          <h3 style={styles.sectionTitle}>Code Example</h3>
          <CollapsibleCode>
            {`function Dropzone() {
  const { chat } = useAIContext();

  const handleDrop = async (e) => {
    e.preventDefault();
    const pdf = Array.from(e.dataTransfer.files)
      .find(f => f.type === 'application/pdf');
    if (!pdf) return;

    // Progress from the transformer surfaces in the assistant
    // loading bubble — same path meetsone's OCR uses.
    await chat.sendMessage(\`Please summarise \${pdf.name}.\`, {
      newChat: true,
      attachments: [pdf],
      openChat: true,
    });
  };

  return <div onDrop={handleDrop} onDragOver={e => e.preventDefault()} />;
}`}
          </CollapsibleCode>
        </div>

        <div style={styles.chatContainer}>
          <UseAIChat />
        </div>
      </div>
    </UseAIProvider>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: '0 20px 20px',
    maxWidth: '1000px',
    margin: '0 auto',
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    margin: '0 0 12px',
    color: '#1f2937',
  },
  dropzone: {
    border: '2px dashed #9ca3af',
    borderRadius: '12px',
    padding: '32px 24px',
    textAlign: 'center',
    background: '#f9fafb',
    transition: 'border-color 0.15s ease, background 0.15s ease',
    marginBottom: '24px',
    cursor: 'copy',
  },
  dropzoneActive: {
    borderColor: '#2563eb',
    background: '#eff6ff',
  },
  dropzoneDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  dropzoneIcon: {
    fontSize: '14px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: '#2563eb',
    marginBottom: '8px',
  },
  dropzoneText: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#1f2937',
    marginBottom: '6px',
  },
  dropzoneHint: {
    fontSize: '13px',
    color: '#6b7280',
    lineHeight: 1.5,
    maxWidth: '480px',
    margin: '0 auto',
  },
  error: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#b91c1c',
    borderRadius: '8px',
    padding: '10px 14px',
    fontSize: '13px',
    marginBottom: '24px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 16px',
  },
  codeSection: {
    background: 'white',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    marginBottom: '24px',
  },
  chatContainer: {
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    height: '500px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
}
