import React, { useState } from 'react';
import { Router, Route, useRouter } from './router';
import TodoPage from './pages/TodoPage';
import CalculatorPage from './pages/CalculatorPage';
import CombinedPage from './pages/CombinedPage';
import MultiListPage from './pages/MultiListPage';
import InvisibleTestPage from './pages/InvisibleTestPage';
import WorkflowDemoPage from './pages/WorkflowDemoPage';
import RemoteMcpToolsPage from './pages/RemoteMcpToolsPage';
import ServerToolsPage from './pages/ServerToolsPage';
import EmbeddedChatPage from './pages/EmbeddedChatPage';
import ProgrammaticChatPage from './pages/ProgrammaticChatPage';
import FileTransformersPage from './pages/FileTransformersPage';
import ErrorTracingTestPage from './pages/ErrorTracingTestPage';
import ClientToolsPage from './pages/ClientToolsPage';
import ChatHistoryPage from './pages/ChatHistoryPage';
import SlashCommandsPage from './pages/SlashCommandsPage';
import CustomUIPage from './pages/CustomUIPage';
import ThemeI18nPage from './pages/ThemeI18nPage';
import SuggestionsPage from './pages/SuggestionsPage';
import DestructiveApprovalPage from './pages/DestructiveApprovalPage';
import MultimodalPage from './pages/MultimodalPage';
import MultiAgentPage from './pages/MultiAgentPage';
import { NavigationAIProvider } from './providers/NavigationAIProvider';

interface NavCategory {
  label: string;
  collapsedByDefault?: boolean;
  items: { path: string; label: string }[];
}

const NAV_CATEGORIES: NavCategory[] = [
  {
    label: 'Getting Started',
    items: [
      { path: '/', label: 'Todo List' },
      { path: '/calculator', label: 'Calculator' },
      { path: '/combined', label: 'Combined Components' },
      { path: '/multi-list', label: 'Multiple Instances' },
    ],
  },
  {
    label: 'Tool Types',
    items: [
      { path: '/client-tools', label: 'Client Tools' },
      { path: '/server-tools', label: 'Server Tools' },
      { path: '/remote-mcp-tools', label: 'Remote MCP Tools' },
    ],
  },
  {
    label: 'Chat Features',
    items: [
      { path: '/embedded-chat', label: 'Embedded Chat' },
      { path: '/programmatic-chat', label: 'Programmatic Chat' },
      { path: '/chat-history', label: 'Chat History' },
      { path: '/slash-commands', label: 'Slash Commands' },
    ],
  },
  {
    label: 'UI Customization',
    items: [
      { path: '/custom-ui', label: 'Custom UI' },
      { path: '/theme-i18n', label: 'Theme & i18n' },
      { path: '/suggestions', label: 'Suggestions' },
      { path: '/destructive-approval', label: 'Destructive Approval' },
    ],
  },
  {
    label: 'Advanced',
    items: [
      { path: '/invisible-test', label: 'Invisible Providers' },
      { path: '/file-transformers', label: 'File Transformers' },
      { path: '/multimodal', label: 'Multimodal' },
      { path: '/multi-agent', label: 'Multi-Agent' },
      { path: '/workflow-demo', label: 'Workflow Integration' },
    ],
  },
  {
    label: 'Internal',
    collapsedByDefault: true,
    items: [
      { path: '/error-tracing-test', label: 'Error Tracing' },
    ],
  },
];

function Sidebar() {
  const { navigate, currentRoute } = useRouter();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const cat of NAV_CATEGORIES) {
      if (cat.collapsedByDefault) {
        initial[cat.label] = true;
      }
    }
    return initial;
  });

  const toggleCategory = (label: string) => {
    setCollapsed(prev => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <nav style={styles.sidebar}>
      <div style={styles.sidebarHeader}>
        <h1 style={styles.sidebarTitle}>use-ai</h1>
      </div>
      <div style={styles.sidebarContent}>
        {NAV_CATEGORIES.map((category) => {
          const isCollapsed = collapsed[category.label] ?? false;
          return (
            <div key={category.label} style={styles.category}>
              <button
                onClick={() => toggleCategory(category.label)}
                style={styles.categoryHeader}
              >
                <span>{category.label.toUpperCase()}</span>
                <span style={styles.chevron}>{isCollapsed ? '+' : '\u2013'}</span>
              </button>
              {!isCollapsed && (
                <div style={styles.categoryItems}>
                  {category.items.map((item) => {
                    const isActive = currentRoute === item.path;
                    return (
                      <button
                        key={item.path}
                        onClick={() => navigate(item.path)}
                        style={{
                          ...styles.navItem,
                          ...(isActive ? styles.navItemActive : {}),
                        }}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function AppContent() {
  return (
    <div style={styles.layout}>
      <Sidebar />
      <main style={styles.main}>
        <Route path="/"><TodoPage /></Route>
        <Route path="/calculator"><CalculatorPage /></Route>
        <Route path="/combined"><CombinedPage /></Route>
        <Route path="/multi-list"><MultiListPage /></Route>
        <Route path="/client-tools"><ClientToolsPage /></Route>
        <Route path="/server-tools"><ServerToolsPage /></Route>
        <Route path="/remote-mcp-tools"><RemoteMcpToolsPage /></Route>
        <Route path="/embedded-chat"><EmbeddedChatPage /></Route>
        <Route path="/programmatic-chat"><ProgrammaticChatPage /></Route>
        <Route path="/chat-history"><ChatHistoryPage /></Route>
        <Route path="/slash-commands"><SlashCommandsPage /></Route>
        <Route path="/custom-ui"><CustomUIPage /></Route>
        <Route path="/theme-i18n"><ThemeI18nPage /></Route>
        <Route path="/suggestions"><SuggestionsPage /></Route>
        <Route path="/destructive-approval"><DestructiveApprovalPage /></Route>
        <Route path="/invisible-test"><InvisibleTestPage /></Route>
        <Route path="/file-transformers"><FileTransformersPage /></Route>
        <Route path="/multimodal"><MultimodalPage /></Route>
        <Route path="/multi-agent"><MultiAgentPage /></Route>
        <Route path="/workflow-demo"><WorkflowDemoPage /></Route>
        <Route path="/error-tracing-test"><ErrorTracingTestPage /></Route>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <NavigationAIProvider>
        <div style={styles.app}>
          <AppContent />
        </div>
      </NavigationAIProvider>
    </Router>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: '100vh',
    background: '#f5f5f5',
  },
  layout: {
    display: 'flex',
    minHeight: '100vh',
  },

  // Sidebar
  sidebar: {
    width: '240px',
    minWidth: '240px',
    background: 'white',
    borderRight: '1px solid #e0e0e0',
    position: 'sticky',
    top: 0,
    height: '100vh',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  },
  sidebarHeader: {
    padding: '20px 16px 12px',
    borderBottom: '1px solid #e0e0e0',
  },
  sidebarTitle: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0,
  },
  sidebarContent: {
    padding: '8px 0',
    flex: 1,
  },

  // Categories
  category: {
    marginBottom: '4px',
  },
  categoryHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '8px 16px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: '600',
    color: '#999',
    letterSpacing: '0.05em',
    textAlign: 'left',
  },
  chevron: {
    fontSize: '12px',
    color: '#bbb',
  },
  categoryItems: {
    display: 'flex',
    flexDirection: 'column',
  },

  // Nav items
  navItem: {
    display: 'block',
    width: '100%',
    padding: '8px 16px 8px 20px',
    background: 'transparent',
    border: 'none',
    borderLeft: '3px solid transparent',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    color: '#555',
    textAlign: 'left',
    transition: 'all 0.15s',
  },
  navItemActive: {
    borderLeftColor: '#007bff',
    background: '#f0f7ff',
    color: '#007bff',
    fontWeight: '600',
  },

  // Main content
  main: {
    flex: 1,
    overflowY: 'auto',
    minWidth: 0,
  },
};
