import React, { useState, useEffect } from 'react';
import { useAI, defineTool, useAIContext } from '@meetsmore-oss/use-ai-client';
import { z } from 'zod';
import { docStyles } from '../styles/docStyles';

// Global token state that forwardedPropsProvider reads
declare global {
  interface Window {
    __useAiDemoToken?: string;
  }
}

export default function BeforeRunAgentPage() {
  const [simulateFailure, setSimulateFailure] = useState(false);
  const { connected } = useAIContext();

  // Sync toggle state to global variable so forwardedPropsProvider picks it up
  useEffect(() => {
    window.__useAiDemoToken = simulateFailure ? 'invalid' : 'valid-demo-token';
    return () => {
      delete window.__useAiDemoToken;
    };
  }, [simulateFailure]);

  const tools = {
    greet: defineTool(
      'Greet the user by name',
      z.object({ name: z.string() }),
      (input) => ({ message: `Hello, ${input.name}!` })
    ),
  };

  const { ref } = useAI({
    tools,
    prompt: `This is a demo page for testing the beforeRunAgent plugin hook. Token mode: ${simulateFailure ? 'INVALID (will be rejected)' : 'VALID (will pass)'}`,
    suggestions: ['Say hello to Alice'],
  });

  return (
    <div style={docStyles.container} ref={ref}>
      <h1 style={docStyles.title}>beforeRunAgent Hook</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          The <code style={docStyles.code}>beforeRunAgent</code> plugin hook runs before every agent
          execution. Plugins can inspect the request (token, session, tools, etc.) and abort the run
          by returning <code style={docStyles.code}>{'{ abort: true, message: "..." }'}</code>.
          Common use cases: authentication, quota enforcement, feature gating.
        </p>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Demo</h2>
        <p style={docStyles.text}>
          Toggle the switch below to simulate an invalid token. When "Simulate Failure" is on,
          the client sends <code style={docStyles.code}>token: "invalid"</code> via{' '}
          <code style={docStyles.code}>forwardedProps</code>. The server-side{' '}
          <code style={docStyles.code}>TokenValidationPlugin</code> detects this and aborts the run
          with a <code style={docStyles.code}>RUN_ERROR</code> event.
        </p>

        <div style={styles.toggleRow}>
          <label style={styles.toggleLabel}>
            <div
              style={{
                ...styles.toggle,
                ...(simulateFailure ? styles.toggleOn : {}),
              }}
              onClick={() => setSimulateFailure((v) => !v)}
            >
              <div
                style={{
                  ...styles.toggleKnob,
                  ...(simulateFailure ? styles.toggleKnobOn : {}),
                }}
              />
            </div>
            <span style={styles.toggleText}>
              Simulate Failure
            </span>
          </label>
          <span
            style={{
              ...styles.badge,
              ...(simulateFailure ? styles.badgeError : styles.badgeSuccess),
            }}
          >
            Token: {simulateFailure ? 'invalid' : 'valid-demo-token'}
          </span>
        </div>

        <div style={styles.statusRow}>
          <span style={{ fontSize: '14px', color: '#666' }}>
            Connection: {connected ? (
              <span style={{ color: '#22c55e', fontWeight: 'bold' }}>Connected</span>
            ) : (
              <span style={{ color: '#ef4444', fontWeight: 'bold' }}>Disconnected</span>
            )}
          </span>
        </div>

        <p style={{ ...docStyles.text, marginTop: '16px', marginBottom: 0 }}>
          Try sending a message in the chat. With the toggle off, the AI will respond normally.
          With the toggle on, you will see a <code style={docStyles.code}>RUN_ERROR</code> instead.
        </p>
      </div>

      <div style={docStyles.contextCard}>
        <h2 style={docStyles.subtitle}>How It Works</h2>
        <ol style={docStyles.list}>
          <li>
            Client sends <code style={docStyles.code}>forwardedProps.token</code> with each message
            via <code style={docStyles.code}>forwardedPropsProvider</code>.
          </li>
          <li>
            Server calls <code style={docStyles.code}>beforeRunAgent(input)</code> on all plugins
            before running the agent.
          </li>
          <li>
            <code style={docStyles.code}>TokenValidationPlugin</code> checks{' '}
            <code style={docStyles.code}>input.originalInput.forwardedProps.token</code>.
            If it contains "invalid", it returns{' '}
            <code style={docStyles.code}>{'{ abort: true, message: "..." }'}</code>.
          </li>
          <li>
            The server emits a <code style={docStyles.code}>RUN_ERROR</code> event to the client
            and does not run the agent.
          </li>
        </ol>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '16px 0',
  },
  toggleLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    cursor: 'pointer',
  },
  toggle: {
    width: '48px',
    height: '26px',
    borderRadius: '13px',
    background: '#d1d5db',
    position: 'relative',
    transition: 'background 0.2s',
    cursor: 'pointer',
  },
  toggleOn: {
    background: '#ef4444',
  },
  toggleKnob: {
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    background: 'white',
    position: 'absolute',
    top: '2px',
    left: '2px',
    transition: 'left 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  },
  toggleKnobOn: {
    left: '24px',
  },
  toggleText: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#374151',
  },
  badge: {
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '13px',
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  badgeSuccess: {
    background: '#dcfce7',
    color: '#166534',
  },
  badgeError: {
    background: '#fef2f2',
    color: '#991b1b',
  },
  statusRow: {
    paddingBottom: '8px',
  },
};
