import React from 'react';
import ReactMarkdown from 'react-markdown';

interface MarkdownContentProps {
  content: string;
}

/**
 * Renders markdown content with appropriate styling for the chat panel.
 */
export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      components={{
        // Override default element rendering for better chat styling
        p: ({ children }) => <p style={{ margin: '0 0 0.5em 0' }}>{children}</p>,
        // Ensure last paragraph has no margin
        h1: ({ children }) => <h1 style={{ margin: '0 0 0.5em 0', fontSize: '1.25em', fontWeight: 600 }}>{children}</h1>,
        h2: ({ children }) => <h2 style={{ margin: '0 0 0.5em 0', fontSize: '1.15em', fontWeight: 600 }}>{children}</h2>,
        h3: ({ children }) => <h3 style={{ margin: '0 0 0.5em 0', fontSize: '1.05em', fontWeight: 600 }}>{children}</h3>,
        ul: ({ children }) => <ul style={{ margin: '0 0 0.5em 0', paddingLeft: '1.5em' }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ margin: '0 0 0.5em 0', paddingLeft: '1.5em' }}>{children}</ol>,
        li: ({ children }) => <li style={{ marginBottom: '0.25em' }}>{children}</li>,
        code: ({ className, children, ...props }) => {
          // Check if this is inline code or a code block
          const isInline = !className;
          if (isInline) {
            return (
              <code
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.1)',
                  padding: '0.1em 0.3em',
                  borderRadius: '3px',
                  fontSize: '0.9em',
                  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
                }}
                {...props}
              >
                {children}
              </code>
            );
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre
            style={{
              margin: '0.5em 0',
              padding: '0.75em',
              backgroundColor: 'rgba(0, 0, 0, 0.1)',
              borderRadius: '6px',
              overflow: 'auto',
              fontSize: '0.85em',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
            }}
          >
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote
            style={{
              margin: '0.5em 0',
              paddingLeft: '1em',
              borderLeft: '3px solid rgba(0, 0, 0, 0.2)',
              color: 'inherit',
              opacity: 0.9,
            }}
          >
            {children}
          </blockquote>
        ),
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'inherit',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
            }}
          >
            {children}
          </a>
        ),
        hr: () => (
          <hr
            style={{
              margin: '0.75em 0',
              border: 'none',
              borderTop: '1px solid rgba(0, 0, 0, 0.2)',
            }}
          />
        ),
        table: ({ children }) => (
          <div style={{ overflowX: 'auto', margin: '0.5em 0' }}>
            <table
              style={{
                borderCollapse: 'collapse',
                fontSize: '0.9em',
                width: '100%',
              }}
            >
              {children}
            </table>
          </div>
        ),
        th: ({ children }) => (
          <th
            style={{
              padding: '0.4em 0.6em',
              borderBottom: '2px solid rgba(0, 0, 0, 0.2)',
              textAlign: 'left',
              fontWeight: 600,
            }}
          >
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td
            style={{
              padding: '0.4em 0.6em',
              borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
            }}
          >
            {children}
          </td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
