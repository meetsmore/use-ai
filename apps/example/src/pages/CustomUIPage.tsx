import React from 'react';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

export default function CustomUIPage() {
  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Custom UI</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          Replace the default floating chat button and panel with your own components using
          the <code style={docStyles.code}>CustomButton</code> and{' '}
          <code style={docStyles.code}>CustomChat</code> props on{' '}
          <code style={docStyles.code}>UseAIProvider</code>. Pass{' '}
          <code style={docStyles.code}>null</code> to disable either component entirely.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Custom Button</h2>
        <CollapsibleCode>
{`import type { FloatingButtonProps } from '@meetsmore-oss/use-ai-client';

function MyButton({ onClick, connected, hasUnread }: FloatingButtonProps) {
  return (
    <button onClick={onClick} style={{ position: 'fixed', bottom: 20, right: 20 }}>
      {connected ? 'Chat' : 'Connecting...'}
      {hasUnread && <span className="badge">!</span>}
    </button>
  );
}

<UseAIProvider CustomButton={MyButton} serverUrl="...">
  <App />
</UseAIProvider>`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Custom Chat Panel</h2>
        <CollapsibleCode>
{`import type { ChatPanelProps } from '@meetsmore-oss/use-ai-client';

function MyChat({ isOpen, onClose, messages, onSendMessage, loading }: ChatPanelProps) {
  if (!isOpen) return null;
  return (
    <div className="my-chat-panel">
      {messages.map(m => <div key={m.id}>{m.content}</div>)}
      <input onKeyDown={(e) => {
        if (e.key === 'Enter') onSendMessage(e.currentTarget.value);
      }} />
    </div>
  );
}

<UseAIProvider CustomChat={MyChat} serverUrl="...">
  <App />
</UseAIProvider>`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Disable Components</h2>
        <CollapsibleCode>
{`// Disable the floating button (chat panel only)
<UseAIProvider CustomButton={null} serverUrl="...">

// Disable the chat panel (button only)
<UseAIProvider CustomChat={null} serverUrl="...">

// Disable both (headless mode — use programmatic API)
<UseAIProvider CustomButton={null} CustomChat={null} serverUrl="...">`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.contextCard}>
        <h2 style={docStyles.subtitle}>onOpenChange Callback</h2>
        <p style={docStyles.text}>
          Use <code style={docStyles.code}>onOpenChange</code> to synchronize the chat panel's
          open/close state with external UI (e.g., a sidebar). This is called when{' '}
          <code style={docStyles.code}>{'sendMessage({ openChat: true })'}</code> is used
          programmatically.
        </p>
        <CollapsibleCode>
{`const [sidebarOpen, setSidebarOpen] = useState(false);

<UseAIProvider
  serverUrl="ws://localhost:8081"
  renderChat={false}
  onOpenChange={(isOpen) => setSidebarOpen(isOpen)}
>
  <Sidebar isOpen={sidebarOpen}>
    <UseAIChat />
  </Sidebar>
</UseAIProvider>`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.annotationsCard}>
        <h2 style={docStyles.subtitle}>See Also</h2>
        <ul style={docStyles.list}>
          <li><strong>Embedded Chat</strong> — live demo of <code style={docStyles.code}>{'renderChat={false}'}</code> with custom layouts</li>
          <li><strong>Programmatic Chat</strong> — using <code style={docStyles.code}>sendMessage()</code> with <code style={docStyles.code}>openChat</code> option</li>
          <li><strong>Theme & i18n</strong> — customizing colors and strings without replacing components</li>
        </ul>
      </div>
    </div>
  );
}
