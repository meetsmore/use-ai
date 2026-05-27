import React, { useState } from 'react';
import { useAI, defineTool } from '@meetsmore-oss/use-ai-client';
import { z } from 'zod';
import { CollapsibleCode } from '../components/CollapsibleCode';
import { docStyles } from '../styles/docStyles';

interface LogEntry {
  id: number;
  text: string;
}

export default function AbortPage() {
  const [log, setLog] = useState<LogEntry[]>([]);

  const append = (text: string) => {
    setLog((prev) => [...prev, { id: Date.now() + Math.random(), text }]);
  };

  const tools = {
    wait: defineTool(
      'Wait for the given number of seconds before returning. Use this to simulate a long-running operation.',
      z.object({
        seconds: z.number().describe('How many seconds to wait'),
        label: z
          .string()
          .describe('A short label describing what is being waited for')
          .optional(),
      }),
      async (input) => {
        const label = input.label ? ` (${input.label})` : '';
        append(`wait started: ${input.seconds}s${label}`);
        await new Promise((resolve) => setTimeout(resolve, input.seconds * 1000));
        append(`wait finished: ${input.seconds}s${label}`);
        return {
          success: true,
          waitedSeconds: input.seconds,
          message: `Waited ${input.seconds} seconds${label}`,
        };
      },
      { annotations: { title: 'Waiting' } }
    ),

    clearLog: defineTool('Clear the activity log', () => {
      setLog([]);
      return { success: true };
    }),
  };

  useAI({
    tools,
    prompt: `Abort Demo. Activity log (${log.length} entries): ${JSON.stringify(
      log.map((e) => e.text)
    )}.`,
    suggestions: [
      'Wait 10 seconds, then tell me you are done',
      'Wait 5 seconds three times in a row',
    ],
  });

  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Abort</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          This page exercises the abort feature. The <code style={docStyles.code}>wait</code>{' '}
          tool runs client-side and blocks for the requested number of seconds before
          returning. While a run is in flight, the chat shows a stop button. Click it
          mid-wait to abort and confirm the conversation stays consistent.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>The wait tool</h2>
        <p style={docStyles.text}>
          An async tool function. The library waits for the returned promise to resolve
          before sending the tool response, so a long wait keeps the run open and gives
          you time to abort.
        </p>
        <CollapsibleCode>
{`const wait = defineTool(
  'Wait for the given number of seconds before returning.',
  z.object({
    seconds: z.number().describe('How many seconds to wait'),
    label: z.string().optional(),
  }),
  async (input) => {
    await new Promise((r) => setTimeout(r, input.seconds * 1000));
    return { success: true, waitedSeconds: input.seconds };
  },
  { annotations: { title: 'Waiting' } }
);`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>How to test</h2>
        <p style={docStyles.text}>
          Try: "Wait 10 seconds, then tell me you are done" or "Wait 5 seconds three
          times in a row". While the wait is running, press the stop button in the chat.
          Watch the log below to see which waits actually started and finished, then send
          a follow-up message to confirm the conversation still works after an abort.
        </p>
        <div style={styles.logPanel}>
          {log.length === 0 ? (
            <span style={styles.logEmpty}>No activity yet</span>
          ) : (
            log.map((entry) => (
              <div key={entry.id} style={styles.logItem}>
                {entry.text}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  logPanel: {
    background: '#f9fafb',
    borderRadius: '8px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    fontFamily: 'monospace',
    fontSize: '13px',
    maxHeight: '300px',
    overflowY: 'auto',
  },
  logEmpty: {
    color: '#9ca3af',
  },
  logItem: {
    color: '#374151',
    padding: '4px 8px',
    background: 'white',
    borderRadius: '4px',
    border: '1px solid #e5e7eb',
  },
};
