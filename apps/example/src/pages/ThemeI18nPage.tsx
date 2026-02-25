import React, { useState } from 'react';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

export default function ThemeI18nPage() {
  const [primaryColor, setPrimaryColor] = useState('#667eea');

  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Theme & i18n</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          Customize the chat UI appearance with the <code style={docStyles.code}>theme</code> prop
          and localize all user-facing strings with the <code style={docStyles.code}>strings</code> prop
          on <code style={docStyles.code}>UseAIProvider</code>. Both accept partial objects —
          only override what you need.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Theme Colors</h2>
        <CollapsibleCode>
{`<UseAIProvider
  serverUrl="ws://localhost:8081"
  theme={{
    primaryColor: '#667eea',
    primaryGradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    primaryColorTranslucent: 'rgba(102, 126, 234, 0.15)',
    backgroundColor: 'white',
    textColor: '#1f2937',
    secondaryTextColor: '#6b7280',
    borderColor: '#e5e7eb',
    onlineColor: '#10b981',
    offlineColor: '#6b7280',
    errorBackground: '#fee2e2',
    errorTextColor: '#dc2626',
    dangerColor: '#ef4444',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  }}
>`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>String Localization</h2>
        <CollapsibleCode>
{`<UseAIProvider
  serverUrl="ws://localhost:8081"
  strings={{
    header: {
      aiAssistant: 'AIアシスタント',
      newChat: '新しいチャット',
      online: 'オンライン',
      offline: 'オフライン',
    },
    emptyChat: {
      startConversation: 'AIアシスタントとの会話を始めましょう',
      askMeToHelp: 'タスクのお手伝いをします！',
    },
    input: {
      placeholder: 'メッセージを入力...',
      thinking: '考え中',
    },
    toolApproval: {
      title: '確認が必要です',
      approve: '許可',
      reject: '拒否',
    },
    errors: {
      API_OVERLOADED: 'APIが過負荷状態です。少し待ってから再試行してください。',
      RATE_LIMITED: 'リクエスト制限に達しました。',
      UNKNOWN_ERROR: '予期しないエラーが発生しました。',
    },
  }}
>`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.annotationsCard}>
        <h2 style={docStyles.subtitle}>Error Messages</h2>
        <p style={docStyles.text}>
          Error codes from the server are mapped to user-facing strings via{' '}
          <code style={docStyles.code}>strings.errors</code>. The three built-in error codes are:
        </p>
        <table style={docStyles.table}>
          <thead>
            <tr>
              <th style={docStyles.th}>Code</th>
              <th style={docStyles.th}>Default Message</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={docStyles.td}><code style={docStyles.code}>API_OVERLOADED</code></td>
              <td style={docStyles.td}>The AI service is currently overloaded. Please try again in a moment.</td>
            </tr>
            <tr>
              <td style={docStyles.tdAlt}><code style={docStyles.code}>RATE_LIMITED</code></td>
              <td style={docStyles.tdAlt}>You've sent too many requests. Please wait a moment.</td>
            </tr>
            <tr>
              <td style={docStyles.td}><code style={docStyles.code}>UNKNOWN_ERROR</code></td>
              <td style={docStyles.td}>An unexpected error occurred. Please try again.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Theme Preview</h2>
        <p style={docStyles.text}>
          Pick a primary color to preview how the theme system works. In a real app,
          pass the <code style={docStyles.code}>theme</code> prop to <code style={docStyles.code}>UseAIProvider</code>.
        </p>
        <div style={styles.colorPicker}>
          <label style={styles.label}>Primary Color:</label>
          <input
            type="color"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            style={styles.colorInput}
          />
          <code style={docStyles.code}>{primaryColor}</code>
        </div>
        <div style={styles.preview}>
          <div style={{ ...styles.previewButton, background: primaryColor }}>
            Open Chat
          </div>
          <div style={{ ...styles.previewBadge, background: primaryColor }}>
            AI Assistant
          </div>
          <div style={{ ...styles.previewLink, color: primaryColor }}>
            Start a conversation
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  colorPicker: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px',
  },
  label: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#374151',
  },
  colorInput: {
    width: '40px',
    height: '32px',
    padding: 0,
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  preview: {
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
    padding: '16px',
    background: '#f9fafb',
    borderRadius: '8px',
  },
  previewButton: {
    padding: '8px 16px',
    color: 'white',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: '600',
  },
  previewBadge: {
    padding: '4px 12px',
    color: 'white',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '500',
  },
  previewLink: {
    fontSize: '13px',
    fontWeight: '500',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
};
