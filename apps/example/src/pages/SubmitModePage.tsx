import React, { useState } from 'react';
import { UseAIProvider, UseAIChat } from '@meetsmore-oss/use-ai-client';
import type { SubmitMode } from '@meetsmore-oss/use-ai-client';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

const SUBMIT_MODES: { value: SubmitMode; label: string; hint: string }[] = [
  {
    value: 'enter',
    label: 'enter (desktop)',
    hint: 'Enter で送信、Shift+Enter で改行',
  },
  {
    value: 'mod-enter',
    label: 'mod-enter (mobile-friendly)',
    hint: 'Enter で改行、Cmd/Ctrl+Enter で送信',
  },
];

export default function SubmitModePage() {
  const [mode, setMode] = useState<SubmitMode>('enter');

  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Submit Mode (Enter key behavior)</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          The chat input&apos;s Enter-key behavior is controlled by the{' '}
          <code style={docStyles.code}>submitMode</code> prop on{' '}
          <code style={docStyles.code}>UseAIProvider</code> (or{' '}
          <code style={docStyles.code}>UseAIChat</code> for per-instance overrides).
          On mobile, soft keyboards have no <code style={docStyles.code}>Cmd</code>/
          <code style={docStyles.code}>Ctrl</code>, so Enter sending the message
          forces accidental submits whenever a user tries to insert a line break.
          Switching to <code style={docStyles.code}>&apos;mod-enter&apos;</code>{' '}
          fixes that: Enter inserts a newline and the user submits via the
          on-screen send button (Cmd/Ctrl+Enter still works for physical keyboards).
        </p>

        <table style={{ ...docStyles.table, marginTop: '12px' }}>
          <thead>
            <tr>
              <th style={docStyles.th}>mode</th>
              <th style={docStyles.th}>Enter</th>
              <th style={docStyles.th}>Shift+Enter</th>
              <th style={docStyles.th}>Cmd/Ctrl+Enter</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={docStyles.td}>
                <code style={docStyles.code}>&apos;enter&apos;</code> (default)
              </td>
              <td style={docStyles.td}>送信</td>
              <td style={docStyles.td}>改行</td>
              <td style={docStyles.td}>送信</td>
            </tr>
            <tr>
              <td style={docStyles.tdAlt}>
                <code style={docStyles.code}>&apos;mod-enter&apos;</code>
              </td>
              <td style={docStyles.tdAlt}>改行</td>
              <td style={docStyles.tdAlt}>改行</td>
              <td style={docStyles.tdAlt}>送信</td>
            </tr>
          </tbody>
        </table>

        <p style={{ ...docStyles.text, marginTop: '12px' }}>
          IME 合成中（日本語入力など）の Enter は、どちらのモードでも送信されません。
        </p>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Try it</h2>
        <p style={docStyles.text}>
          Pick a mode and try the chat below. Type some text and press Enter,
          Shift+Enter, or Cmd/Ctrl+Enter to see the difference.
        </p>

        <div style={styles.modeRow}>
          {SUBMIT_MODES.map((m) => {
            const isActive = mode === m.value;
            return (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                style={{
                  ...styles.modeButton,
                  ...(isActive ? styles.modeButtonActive : {}),
                }}
              >
                <span style={styles.modeButtonLabel}>{m.label}</span>
                <span style={styles.modeButtonHint}>{m.hint}</span>
              </button>
            );
          })}
        </div>

        <div style={styles.providerWrapper}>
          {/*
           * Re-mount the provider when `mode` changes so the new submitMode
           * is picked up cleanly. In a real app you would set the mode once
           * (e.g. based on `isMobileApp()`) and not toggle it at runtime.
           */}
          <UseAIProvider
            key={mode}
            serverUrl="ws://localhost:8081"
            renderChat={false}
            submitMode={mode}
          >
            <div style={styles.chatPanel}>
              <UseAIChat />
            </div>
          </UseAIProvider>
        </div>
      </div>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>Usage</h2>
        <CollapsibleCode>{`import { UseAIProvider } from '@meetsmore-oss/use-ai-client';

// Pick the mode based on your environment.
// e.g. on meetsone: \`isMobileApp() ? 'mod-enter' : 'enter'\`
<UseAIProvider
  serverUrl="wss://your-server.com"
  submitMode="mod-enter"
>
  <App />
</UseAIProvider>`}</CollapsibleCode>

        <p style={{ ...docStyles.text, marginTop: '12px' }}>
          You can also override per-instance via{' '}
          <code style={docStyles.code}>{'<UseAIChat submitMode="mod-enter" />'}</code>,
          which is useful when the same provider serves both a desktop and a
          mobile-styled UI.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  modeRow: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
    flexWrap: 'wrap',
  },
  modeButton: {
    flex: '1 1 240px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '4px',
    padding: '12px 16px',
    background: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.15s',
  },
  modeButtonActive: {
    borderColor: '#007bff',
    background: '#f0f7ff',
  },
  modeButtonLabel: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#1f2937',
    fontFamily: 'monospace',
  },
  modeButtonHint: {
    fontSize: '12px',
    color: '#6b7280',
  },
  providerWrapper: {
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  chatPanel: {
    height: '420px',
    display: 'flex',
    flexDirection: 'column',
  },
};
