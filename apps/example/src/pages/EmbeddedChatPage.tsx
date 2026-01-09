import React, { useState } from 'react';
import { UseAIProvider, UseAIChat } from '@meetsmore-oss/use-ai-client';

type LayoutType = 'sidebar' | 'split' | 'compact';

function DemoContent({ title }: { title: string }) {
  return (
    <div style={styles.demoContent}>
      <h3 style={styles.demoTitle}>{title}</h3>
      <p style={styles.demoText}>
        This is sample content. The chat panel is embedded in a container and fills the available space.
      </p>
      <div style={styles.demoActions}>
        <button style={styles.demoButton}>Action 1</button>
        <button style={styles.demoButton}>Action 2</button>
      </div>
    </div>
  );
}

function SidebarLayout() {
  return (
    <div style={styles.layoutContainer}>
      <div style={styles.sidebarLayout}>
        {/* Main content area */}
        <div style={styles.mainContent}>
          <DemoContent title="Main Content Area" />
          <div style={styles.contentCards}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={styles.card}>
                <h4 style={styles.cardTitle}>Card {i}</h4>
                <p style={styles.cardText}>Sample card content goes here.</p>
              </div>
            ))}
          </div>
        </div>

        {/* Chat sidebar - UseAIChat fills this container */}
        <div style={styles.chatSidebar}>
          <UseAIChat />
        </div>
      </div>
    </div>
  );
}

function SplitLayout() {
  return (
    <div style={styles.layoutContainer}>
      <div style={styles.splitLayout}>
        {/* Left panel - content */}
        <div style={styles.splitPanel}>
          <DemoContent title="Left Panel" />
        </div>

        {/* Right panel - embedded chat */}
        <div style={styles.splitPanel}>
          <UseAIChat />
        </div>
      </div>
    </div>
  );
}

function CompactLayout() {
  return (
    <div style={styles.layoutContainer}>
      <div style={styles.compactLayout}>
        {/* Top content */}
        <div style={styles.compactTop}>
          <DemoContent title="Compact Mode - Chat Below" />
        </div>

        {/* Bottom chat area */}
        <div style={styles.compactBottom}>
          <UseAIChat />
        </div>
      </div>
    </div>
  );
}

export default function EmbeddedChatPage() {
  const [layout, setLayout] = useState<LayoutType>('sidebar');

  const layouts: { type: LayoutType; label: string; description: string }[] = [
    { type: 'sidebar', label: 'Sidebar', description: 'Chat in a right sidebar (380px width)' },
    { type: 'split', label: 'Split View', description: '50/50 split between content and chat' },
    { type: 'compact', label: 'Compact', description: 'Chat in a bottom panel (400px height)' },
  ];

  return (
    <UseAIProvider
      serverUrl="ws://localhost:8081"
      renderChat={false}
    >
      <div style={styles.page}>
        {/* Layout selector */}
        <div style={styles.selector}>
          <h2 style={styles.pageTitle}>Embedded Chat Demo</h2>
          <p style={styles.pageDescription}>
            Using <code style={styles.code}>&lt;UseAIChat&gt;</code> component with{' '}
            <code style={styles.code}>renderChat=&#123;false&#125;</code> to place chat anywhere.
          </p>
          <div style={styles.layoutButtons}>
            {layouts.map(({ type, label, description }) => (
              <button
                key={type}
                onClick={() => setLayout(type)}
                style={{
                  ...styles.layoutButton,
                  ...(layout === type ? styles.layoutButtonActive : {}),
                }}
                title={description}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Selected layout */}
        {layout === 'sidebar' && <SidebarLayout />}
        {layout === 'split' && <SplitLayout />}
        {layout === 'compact' && <CompactLayout />}
      </div>
    </UseAIProvider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: '0 20px 20px',
    maxWidth: '1400px',
    margin: '0 auto',
  },
  selector: {
    marginBottom: '20px',
  },
  pageTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    margin: '0 0 8px',
    color: '#1f2937',
  },
  pageDescription: {
    color: '#6b7280',
    margin: '0 0 16px',
    fontSize: '14px',
  },
  code: {
    background: '#f3f4f6',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '13px',
    fontFamily: 'monospace',
  },
  layoutButtons: {
    display: 'flex',
    gap: '8px',
  },
  layoutButton: {
    padding: '10px 20px',
    background: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    transition: 'all 0.2s',
  },
  layoutButtonActive: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    borderColor: 'transparent',
    color: 'white',
  },
  layoutContainer: {
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    overflow: 'hidden',
  },

  // Sidebar layout
  sidebarLayout: {
    display: 'flex',
    height: 'calc(100vh - 220px)',
    minHeight: '500px',
  },
  mainContent: {
    flex: 1,
    padding: '24px',
    overflowY: 'auto',
  },
  chatSidebar: {
    width: '380px',
    borderLeft: '1px solid #e5e7eb',
    display: 'flex',
    flexDirection: 'column',
  },

  // Split layout
  splitLayout: {
    display: 'flex',
    height: 'calc(100vh - 220px)',
    minHeight: '500px',
  },
  splitPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },

  // Compact layout
  compactLayout: {
    display: 'flex',
    flexDirection: 'column',
    height: 'calc(100vh - 220px)',
    minHeight: '500px',
  },
  compactTop: {
    flex: 1,
    padding: '24px',
    overflowY: 'auto',
  },
  compactBottom: {
    height: '400px',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    flexDirection: 'column',
  },

  // Demo content
  demoContent: {
    marginBottom: '24px',
  },
  demoTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 8px',
  },
  demoText: {
    color: '#6b7280',
    margin: '0 0 16px',
    fontSize: '14px',
    lineHeight: '1.6',
  },
  demoActions: {
    display: 'flex',
    gap: '8px',
  },
  demoButton: {
    padding: '8px 16px',
    background: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#374151',
  },

  // Cards
  contentCards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '16px',
  },
  card: {
    padding: '16px',
    background: '#f9fafb',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
  },
  cardTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 8px',
  },
  cardText: {
    fontSize: '13px',
    color: '#6b7280',
    margin: 0,
  },
};
