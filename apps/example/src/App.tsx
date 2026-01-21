import React from 'react';
import { Router, Route, useRouter } from './router';
import TodoPage from './pages/TodoPage';
import CalculatorPage from './pages/CalculatorPage';
import CombinedPage from './pages/CombinedPage';
import MultiListPage from './pages/MultiListPage';
import InvisibleTestPage from './pages/InvisibleTestPage';
import WorkflowDemoPage from './pages/WorkflowDemoPage';
import RemoteMcpToolsPage from './pages/RemoteMcpToolsPage';
import EmbeddedChatPage from './pages/EmbeddedChatPage';
import ProgrammaticChatPage from './pages/ProgrammaticChatPage';

function Navigation() {
  const { navigate, currentRoute } = useRouter();

  const navItems = [
    { path: '/', label: 'Todo' },
    { path: '/calculator', label: 'Calculator' },
    { path: '/combined', label: 'Combined' },
    { path: '/multi-list', label: 'Multi-List' },
    { path: '/invisible-test', label: 'Invisible Test' },
    { path: '/workflow-demo', label: 'Workflow Demo' },
    { path: '/remote-mcp-tools', label: 'Remote MCP Tools' },
    { path: '/embedded-chat', label: 'Embedded Chat' },
    { path: '/programmatic-chat', label: 'Programmatic Chat' },
  ];

  return (
    <nav style={styles.nav}>
      <div style={styles.navContainer}>
        <h1 style={styles.navTitle}>use-ai Demo</h1>
        <div style={styles.navLinks}>
          {navItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                ...styles.navLink,
                ...(currentRoute === item.path ? styles.navLinkActive : {}),
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}

function AppContent() {
  return (
    <>
      <Navigation />
      <Route path="/">
        <TodoPage />
      </Route>
      <Route path="/calculator">
        <CalculatorPage />
      </Route>
      <Route path="/combined">
        <CombinedPage />
      </Route>
      <Route path="/multi-list">
        <MultiListPage />
      </Route>
      <Route path="/invisible-test">
        <InvisibleTestPage />
      </Route>
      <Route path="/workflow-demo">
        <WorkflowDemoPage />
      </Route>
      <Route path="/remote-mcp-tools">
        <RemoteMcpToolsPage />
      </Route>
      <Route path="/embedded-chat">
        <EmbeddedChatPage />
      </Route>
      <Route path="/programmatic-chat">
        <ProgrammaticChatPage />
      </Route>
    </>
  );
}

export default function App() {
  return (
    <Router>
      <div style={styles.app}>
        <AppContent />
      </div>
    </Router>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: '100vh',
    background: '#f5f5f5',
  },
  nav: {
    background: 'white',
    borderBottom: '1px solid #e0e0e0',
    padding: '16px 0',
    marginBottom: '24px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
  },
  navContainer: {
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '0 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0,
  },
  navLinks: {
    display: 'flex',
    gap: '8px',
  },
  navLink: {
    padding: '8px 16px',
    background: 'transparent',
    color: '#666',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s',
  },
  navLinkActive: {
    background: '#007bff',
    color: 'white',
  },
};
