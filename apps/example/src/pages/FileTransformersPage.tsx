import React from 'react';
import { UseAIProvider, UseAIChat, type FileTransformer } from '@meetsmore-oss/use-ai-client';

/**
 * PDF Transformer - Simulates processing with progress updates.
 * Shows the circular progress indicator filling up.
 */
const pdfTransformer: FileTransformer = {
  async transform(file, onProgress) {
    console.log(`[PDF Transformer] Starting to process: ${file.name}`);

    // Simulate processing in 5 steps
    const steps = [
      { progress: 20, message: 'Reading PDF...' },
      { progress: 40, message: 'Extracting text...' },
      { progress: 60, message: 'Parsing content...' },
      { progress: 80, message: 'Formatting output...' },
      { progress: 100, message: 'Complete!' },
    ];

    for (const step of steps) {
      await sleep(800); // 800ms per step = 4 seconds total
      console.log(`[PDF Transformer] ${step.message} (${step.progress}%)`);
      onProgress?.(step.progress);
    }

    // Return a mock "extracted" content
    return `[Extracted PDF Content from "${file.name}"]

This is simulated extracted text from the PDF file.
The transformer processed ${file.size} bytes.

--- Mock Content ---
Page 1: Introduction
This document contains important information about the topic.

Page 2: Details
Here are the specific details you need to know.

Page 3: Conclusion
In summary, this PDF has been successfully processed.
--- End of Content ---`;
  },
};

/**
 * Image Transformer - Simulates processing without progress updates.
 * Shows the infinite spinner (indeterminate progress).
 */
const imageTransformer: FileTransformer = {
  async transform(file) {
    console.log(`[Image Transformer] Starting to process: ${file.name}`);

    // Simulate processing without progress updates (shows spinner)
    await sleep(2000); // 2 seconds

    console.log(`[Image Transformer] Complete!`);

    // Return a mock "description" of the image
    return `[Image Analysis for "${file.name}"]

Image Type: ${file.type}
File Size: ${formatFileSize(file.size)}
Dimensions: (simulated) 1920x1080

--- AI Description ---
This image appears to contain visual content that has been analyzed.
The transformer processed the image without granular progress updates,
demonstrating the infinite spinner (indeterminate progress) UI.
--- End of Analysis ---`;
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileTransformersPage() {
  return (
    <UseAIProvider
      serverUrl="ws://localhost:8081"
      renderChat={false}
      fileUploadConfig={{
        maxFileSize: 10 * 1024 * 1024, // 10MB
        acceptedTypes: ['application/pdf', 'image/*'],
        transformers: {
          'application/pdf': pdfTransformer,
          'image/*': imageTransformer,
        },
      }}
    >
      <div style={styles.page}>
        <h2 style={styles.title}>File Transformers Demo</h2>

        <p style={styles.description}>
          This page demonstrates the file transformer feature. Transformers process uploaded files
          before sending them to the AI, converting them into text representations.
        </p>

        <div style={styles.instructions}>
          <h3 style={styles.sectionTitle}>How to Test</h3>

          <div style={styles.transformerSection}>
            <h4 style={styles.transformerTitle}>
              1. PDF Transformer <span style={styles.badge}>Progress Indicator</span>
            </h4>
            <p style={styles.transformerDescription}>
              Upload any PDF file. You'll see a <strong>circular progress indicator</strong> that
              fills up as the transformer "processes" the file (simulated with 5 steps over ~4 seconds).
            </p>
            <ul style={styles.list}>
              <li>Click the attachment button (paperclip icon) in the chat</li>
              <li>Select a PDF file</li>
              <li>Click Send</li>
              <li>Watch the progress indicator fill from 0% to 100%</li>
            </ul>
          </div>

          <div style={styles.transformerSection}>
            <h4 style={styles.transformerTitle}>
              2. Image Transformer <span style={styles.badgeAlt}>Spinner</span>
            </h4>
            <p style={styles.transformerDescription}>
              Upload any image file (PNG, JPG, GIF, etc.). You'll see an <strong>infinite spinner</strong>
              since this transformer doesn't report progress (simulated with a 2-second delay).
            </p>
            <ul style={styles.list}>
              <li>Click the attachment button in the chat</li>
              <li>Select an image file</li>
              <li>Click Send</li>
              <li>Watch the circular spinner animate</li>
            </ul>
          </div>

          <div style={styles.note}>
            <strong>Note:</strong> The transformers convert files to text before sending to the AI.
            The AI receives the transformed text content, not the original file data. Check the browser
            console to see transformer logs.
          </div>
        </div>

        <div style={styles.codeSection}>
          <h3 style={styles.sectionTitle}>Code Example</h3>
          <pre style={styles.code}>{`// Configure transformers in UseAIProvider
<UseAIProvider
  serverUrl="ws://localhost:8081"
  fileUploadConfig={{
    transformers: {
      // PDF transformer with progress updates
      'application/pdf': {
        async transform(file, onProgress) {
          // Report progress (0-100) to show circular progress
          onProgress?.(25);
          await processStep1(file);
          onProgress?.(50);
          await processStep2(file);
          onProgress?.(100);
          return extractedText;
        },
      },
      // Image transformer without progress (shows spinner)
      'image/*': {
        async transform(file) {
          // No onProgress calls = infinite spinner
          const description = await analyzeImage(file);
          return description;
        },
      },
    },
  }}
>
  <App />
</UseAIProvider>`}</pre>
        </div>

        {/* Chat panel */}
        <div style={styles.chatContainer}>
          <UseAIChat />
        </div>
      </div>
    </UseAIProvider>
  );
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
  description: {
    color: '#6b7280',
    margin: '0 0 24px',
    fontSize: '15px',
    lineHeight: 1.6,
  },
  instructions: {
    background: 'white',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    marginBottom: '24px',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 16px',
  },
  transformerSection: {
    marginBottom: '20px',
    paddingBottom: '20px',
    borderBottom: '1px solid #e5e7eb',
  },
  transformerTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
    margin: '0 0 8px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  badge: {
    fontSize: '11px',
    fontWeight: '500',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    padding: '2px 8px',
    borderRadius: '12px',
  },
  badgeAlt: {
    fontSize: '11px',
    fontWeight: '500',
    background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    color: 'white',
    padding: '2px 8px',
    borderRadius: '12px',
  },
  transformerDescription: {
    color: '#6b7280',
    margin: '0 0 12px',
    fontSize: '14px',
    lineHeight: 1.5,
  },
  list: {
    margin: '0',
    paddingLeft: '20px',
    color: '#6b7280',
    fontSize: '13px',
    lineHeight: 1.8,
  },
  note: {
    background: '#fef3c7',
    border: '1px solid #fcd34d',
    borderRadius: '8px',
    padding: '12px 16px',
    fontSize: '13px',
    color: '#92400e',
    marginTop: '16px',
  },
  codeSection: {
    background: 'white',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    marginBottom: '24px',
  },
  code: {
    background: '#1f2937',
    color: '#e5e7eb',
    padding: '16px',
    borderRadius: '8px',
    fontSize: '12px',
    lineHeight: 1.6,
    overflow: 'auto',
    margin: 0,
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
};
