import React from 'react';
import { useAI } from '@meetsmore-oss/use-ai-client';

export default function CitationsPage() {
  const { ref } = useAI({
    // Citation instructions are automatically added to the system prompt by AISDKAgent
    // when citations are enabled (which is the default)
    prompt: `You are a helpful assistant with web search capabilities.
When users ask questions, use the web_search tool to find current information and provide comprehensive answers.`,
    suggestions: [
      'What are the latest React 19 features?',
      'What is the current version of TypeScript?',
      'What are the newest AI SDK features from Vercel?',
      'What is Claude 4 capable of?',
    ],
  });

  return (
    <div ref={ref} style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Web Search Citations Demo</h1>
        <p style={styles.subtitle}>
          This page demonstrates real-time web search with automatic citation support.
          Ask any question and the AI will search the web and cite its sources.
        </p>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>How It Works</h2>
          <ul style={styles.list}>
            <li>Uses Anthropic's native <code>web_search</code> tool for real-time web access</li>
            <li>AI SDK emits <code>source</code> chunks containing URLs and metadata</li>
            <li>AISDKAgent converts sources to citations via AG-UI protocol events</li>
            <li>MarkdownContent renders citations as chiclet buttons at the end of messages</li>
          </ul>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Try These Questions</h2>
          <div style={styles.suggestions}>
            {[
              'What are the latest React 19 features?',
              'What is the current version of TypeScript?',
              'What are the newest AI SDK features from Vercel?',
              'What is Claude 4 capable of?',
              'What are the top JavaScript frameworks in 2025?',
              'What is new in Node.js 22?',
            ].map((question, index) => (
              <div key={index} style={styles.suggestionCard}>
                <span style={styles.questionIcon}>?</span>
                <span>{question}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.infoBox}>
          <strong>Setup Required:</strong> Enable web search via environment variable:
          <br /><br />
          <code style={styles.code}>ANTHROPIC_WEB_SEARCH=true bun run start:server</code>
          <br /><br />
          Optional: <code style={styles.code}>ANTHROPIC_WEB_SEARCH_MAX_USES=5</code> (default: 5)
          <br /><br />
          <strong>Note:</strong> Web search costs $10 per 1,000 searches.
          Ensure web search is enabled in your Anthropic Console settings.
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
    marginBottom: '24px',
    lineHeight: '1.5',
  },
  section: {
    marginBottom: '24px',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '12px',
    color: '#333',
  },
  list: {
    fontSize: '14px',
    color: '#555',
    lineHeight: '1.8',
    paddingLeft: '20px',
  },
  suggestions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '12px',
  },
  suggestionCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    background: '#f8f9fa',
    borderRadius: '8px',
    fontSize: '14px',
    color: '#333',
  },
  questionIcon: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: '#007bff',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 'bold',
    flexShrink: 0,
  },
  infoBox: {
    padding: '16px',
    background: '#fff3cd',
    borderRadius: '8px',
    fontSize: '13px',
    color: '#856404',
    lineHeight: '1.5',
  },
  code: {
    background: 'rgba(0,0,0,0.1)',
    padding: '4px 8px',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '12px',
  },
};
