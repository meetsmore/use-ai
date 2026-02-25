import React, { useState } from 'react';
import { Highlight } from 'prism-react-renderer';
import type { Language } from 'prism-react-renderer';
import { docStyles } from '../styles/docStyles';
import { codeTheme } from '../styles/codeTheme';

interface CollapsibleCodeProps {
  children: string;
  /** @default false */
  defaultOpen?: boolean;
  /** @default "tsx" */
  language?: Language;
}

/**
 * A code block that is collapsed by default with a "Show code" toggle.
 * Uses prism-react-renderer for syntax highlighting.
 */
export function CollapsibleCode({ children, defaultOpen = false, language = 'tsx' }: CollapsibleCodeProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={styles.wrapper}>
      <button
        onClick={() => setOpen(prev => !prev)}
        style={styles.toggle}
      >
        <span style={styles.chevron}>{open ? '\u25BE' : '\u25B8'}</span>
        {open ? 'Hide code' : 'Show code'}
      </button>
      {open && (
        <Highlight theme={codeTheme} code={children} language={language}>
          {({ style, tokens, getLineProps, getTokenProps }) => (
            <div style={{ ...docStyles.codeBlock, ...style }}>
              <pre style={docStyles.pre}>
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })}>
                    {line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </Highlight>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    marginTop: '12px',
    marginBottom: '12px',
  },
  toggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    background: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500',
    color: '#6b7280',
    fontFamily: 'monospace',
  },
  chevron: {
    fontSize: '10px',
  },
};
