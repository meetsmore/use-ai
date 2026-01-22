import React, { useState } from 'react';
import { UseAIProvider, UseAIChat, useAIContext } from '@meetsmore-oss/use-ai-client';

type LayoutType = 'sidebar' | 'collapsible' | 'split' | 'compact';

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

/**
 * Collapsible sidebar content that uses programmatic chat control.
 * This demonstrates the onOpenChange callback integration.
 */
function CollapsibleSidebarContent({ isOpen, setIsOpen }: { isOpen: boolean; setIsOpen: (open: boolean) => void }) {
  const { chat, connected } = useAIContext();
  const [isSending, setIsSending] = useState(false);

  const handleSendAndOpen = async () => {
    if (!connected || isSending) return;
    setIsSending(true);
    try {
      // This will trigger onOpenChange(true) which opens the sidebar
      await chat.sendMessage('Hello! I just clicked a button to send this message.', { openChat: true });
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div style={styles.layoutContainer}>
      <div style={styles.sidebarLayout}>
        {/* Main content area */}
        <div style={styles.mainContent}>
          <DemoContent title="Collapsible Sidebar Demo" />

          <div style={styles.collapsibleDemo}>
            <h4 style={styles.collapsibleDemoTitle}>Programmatic Chat Control</h4>
            <p style={styles.collapsibleDemoText}>
              This demo shows how <code style={styles.code}>onOpenChange</code> works with externally managed sidebars.
              The sidebar state is managed in React, and <code style={styles.code}>sendMessage()</code> with{' '}
              <code style={styles.code}>openChat: true</code> triggers the <code style={styles.code}>onOpenChange</code> callback.
            </p>

            <div style={styles.statusBadge} data-testid="connection-status">
              Status: {connected ? (
                <span style={styles.connected} data-testid="status-connected">Connected</span>
              ) : (
                <span style={styles.disconnected} data-testid="status-disconnected">Disconnected</span>
              )}
            </div>

            <div style={styles.buttonGroup}>
              <button
                style={styles.toggleButton}
                onClick={() => setIsOpen(!isOpen)}
                data-testid="toggle-sidebar-button"
              >
                {isOpen ? 'Close Sidebar' : 'Open Sidebar'}
              </button>
              <button
                style={{
                  ...styles.toggleButton,
                  ...styles.sendButton,
                }}
                onClick={handleSendAndOpen}
                disabled={!connected || isSending}
                data-testid="send-and-open-button"
              >
                {isSending ? 'Sending...' : 'Send Message & Open Sidebar'}
              </button>
            </div>

            <div style={styles.codeExample}>
              <h5 style={styles.codeExampleTitle}>Code Example</h5>
              <pre style={styles.codeBlock}>
{`const [sidebarOpen, setSidebarOpen] = useState(false);

<UseAIProvider
  serverUrl="ws://localhost:8081"
  renderChat={false}
  onOpenChange={(isOpen) => {
    // Called when sendMessage({ openChat: true }) is used
    setSidebarOpen(isOpen);
  }}
>
  <Sidebar isOpen={sidebarOpen}>
    <UseAIChat />
  </Sidebar>
</UseAIProvider>`}
              </pre>
            </div>
          </div>

          <div style={styles.contentCards}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={styles.card}>
                <h4 style={styles.cardTitle}>Card {i}</h4>
                <p style={styles.cardText}>Sample card content goes here.</p>
              </div>
            ))}
          </div>
        </div>

        {/* Collapsible chat sidebar */}
        <div
          style={{
            ...styles.chatSidebar,
            ...styles.collapsibleChatSidebar,
            width: isOpen ? '380px' : '0px',
            borderLeft: isOpen ? '1px solid #e5e7eb' : 'none',
          }}
          data-testid="collapsible-sidebar"
        >
          {isOpen && <UseAIChat />}
        </div>
      </div>
    </div>
  );
}

/**
 * Wrapper component that provides the UseAIProvider with onOpenChange.
 */
function CollapsibleSidebarLayout() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <UseAIProvider
      serverUrl="ws://localhost:8081"
      renderChat={false}
      onOpenChange={(open) => {
        console.log('[CollapsibleSidebar] onOpenChange called:', open);
        setIsOpen(open);
      }}
    >
      <CollapsibleSidebarContent isOpen={isOpen} setIsOpen={setIsOpen} />
    </UseAIProvider>
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
  const [layout, setLayout] = useState<LayoutType>('collapsible');

  const layouts: { type: LayoutType; label: string; description: string }[] = [
    { type: 'collapsible', label: 'Collapsible', description: 'Collapsible sidebar with onOpenChange demo' },
    { type: 'sidebar', label: 'Sidebar', description: 'Chat in a right sidebar (380px width)' },
    { type: 'split', label: 'Split View', description: '50/50 split between content and chat' },
    { type: 'compact', label: 'Compact', description: 'Chat in a bottom panel (400px height)' },
  ];

  // Collapsible layout has its own UseAIProvider with onOpenChange
  if (layout === 'collapsible') {
    return (
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

        <CollapsibleSidebarLayout />
      </div>
    );
  }

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
  collapsibleChatSidebar: {
    transition: 'width 0.3s ease-in-out',
    overflow: 'hidden',
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

  // Collapsible demo
  collapsibleDemo: {
    background: '#f9fafb',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '24px',
    border: '1px solid #e5e7eb',
  },
  collapsibleDemoTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 8px',
  },
  collapsibleDemoText: {
    fontSize: '14px',
    color: '#6b7280',
    margin: '0 0 16px',
    lineHeight: '1.6',
  },
  statusBadge: {
    marginBottom: '16px',
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
  buttonGroup: {
    display: 'flex',
    gap: '12px',
    marginBottom: '20px',
  },
  toggleButton: {
    padding: '10px 20px',
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
    transition: 'all 0.2s',
  },
  sendButton: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    borderColor: 'transparent',
    color: 'white',
  },
  codeExample: {
    background: 'white',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid #e5e7eb',
  },
  codeExampleTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 12px',
  },
  codeBlock: {
    background: '#1e1e1e',
    color: '#d4d4d4',
    padding: '16px',
    borderRadius: '8px',
    overflow: 'auto',
    fontSize: '12px',
    lineHeight: '1.5',
    fontFamily: 'monospace',
    margin: 0,
  },
};
