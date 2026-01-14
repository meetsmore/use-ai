import React, { useMemo, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Citation } from '../types';
import { CITATION_PATTERN } from '../types';

interface MarkdownContentProps {
  content: string;
  /** Optional citations to render as chiclet buttons at the end of paragraphs */
  citations?: Citation[];
}

/**
 * Renders a single citation as a pill-shaped chiclet button.
 */
function CitationChiclet({ citation }: { citation: Citation }) {
  const domain = citation.url
    ? new URL(citation.url).hostname.replace('www.', '')
    : citation.title || 'Source';

  return (
    <a
      href={citation.url}
      target="_blank"
      rel="noopener noreferrer"
      title={citation.title || citation.url}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        backgroundColor: 'rgba(0, 0, 0, 0.1)',
        borderRadius: '12px',
        fontSize: '0.75em',
        color: 'inherit',
        textDecoration: 'none',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {domain}
    </a>
  );
}

/**
 * Renders citations as inline chiclet buttons.
 */
function InlineCitationChiclets({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;

  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px', marginLeft: '4px' }}>
      {citations.map(c => <CitationChiclet key={c.id} citation={c} />)}
    </span>
  );
}

/**
 * Extracts citation numbers from text content.
 * Matches Markdown footnote markers like [^1], [^2], [^1,2]
 */
function extractCitationNumbers(text: string): number[] {
  const numbers: number[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(CITATION_PATTERN.source, 'g');
  while ((match = pattern.exec(text)) !== null) {
    // match[1] contains the number(s) inside [^...]
    // e.g., "1" or "1,2" for multiple sources
    const ids = match[1].split(',');
    for (const id of ids) {
      const num = parseInt(id, 10);
      if (!isNaN(num)) {
        numbers.push(num);
      }
    }
  }
  return numbers;
}

/**
 * Strips citation markers ([^1], [^2], etc.) from text.
 * Preserves leading/trailing whitespace to maintain spacing around inline elements.
 */
function stripCitationMarkers(text: string): string {
  // Remove markers and collapse multiple spaces, but preserve leading/trailing whitespace
  return text.replace(CITATION_PATTERN, '').replace(/ {2,}/g, ' ');
}

/**
 * Recursively extracts text content from React children.
 */
function getTextContent(children: ReactNode): string {
  if (typeof children === 'string') {
    return children;
  }
  if (typeof children === 'number') {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(getTextContent).join('');
  }
  if (React.isValidElement(children) && children.props.children) {
    return getTextContent(children.props.children);
  }
  return '';
}

/**
 * Recursively processes children to strip citation markers from text.
 */
function stripCitationsFromChildren(children: ReactNode): ReactNode {
  if (typeof children === 'string') {
    return stripCitationMarkers(children);
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => {
      const processed = stripCitationsFromChildren(child);
      return processed !== child ? <React.Fragment key={index}>{processed}</React.Fragment> : child;
    });
  }
  if (React.isValidElement(children) && children.props.children) {
    return React.cloneElement(children, {
      ...children.props,
      children: stripCitationsFromChildren(children.props.children),
    });
  }
  return children;
}

/**
 * Renders markdown content with appropriate styling for the chat panel.
 * Markdown footnote citation markers ([^1], [^2], etc.) are stripped from text
 * and rendered as chiclet buttons at the end of each paragraph.
 */
export function MarkdownContent({ content, citations = [] }: MarkdownContentProps) {
  // Create a helper to process block elements with citations
  // Always strips citation markers from text, and renders chiclets for matched citations
  const processBlockWithCitations = (children: ReactNode) => {
    // Always strip citation markers from the text
    const strippedChildren = stripCitationsFromChildren(children);

    // Only look up citations if we have citation data
    if (citations.length === 0) {
      return { children: strippedChildren, citationChiclets: null };
    }

    const textContent = getTextContent(children);
    const citationNumbers = extractCitationNumbers(textContent);
    const matchedCitations = citationNumbers
      .map(num => citations.find(c => c.number === num))
      .filter((c): c is Citation => c !== undefined && c.url !== undefined);

    // De-duplicate by URL to avoid showing multiple chiclets for the same source
    const uniqueCitations = matchedCitations.filter(
      (citation, index, self) => self.findIndex(c => c.url === citation.url) === index
    );

    const chiclets = uniqueCitations.length > 0
      ? <InlineCitationChiclets citations={uniqueCitations} />
      : null;

    return { children: strippedChildren, citationChiclets: chiclets };
  };

  const components = useMemo(() => ({
    p: ({ children }: { children: ReactNode }) => {
      const { children: processed, citationChiclets } = processBlockWithCitations(children);
      return (
        <p style={{ margin: '0 0 0.5em 0' }}>
          {processed}
          {citationChiclets}
        </p>
      );
    },
    h1: ({ children }: { children: ReactNode }) => {
      const { children: processed, citationChiclets } = processBlockWithCitations(children);
      return (
        <h1 style={{ margin: '0 0 0.5em 0', fontSize: '1.25em', fontWeight: 600 }}>
          {processed}
          {citationChiclets}
        </h1>
      );
    },
    h2: ({ children }: { children: ReactNode }) => {
      const { children: processed, citationChiclets } = processBlockWithCitations(children);
      return (
        <h2 style={{ margin: '0 0 0.5em 0', fontSize: '1.15em', fontWeight: 600 }}>
          {processed}
          {citationChiclets}
        </h2>
      );
    },
    h3: ({ children }: { children: ReactNode }) => {
      const { children: processed, citationChiclets } = processBlockWithCitations(children);
      return (
        <h3 style={{ margin: '0 0 0.5em 0', fontSize: '1.05em', fontWeight: 600 }}>
          {processed}
          {citationChiclets}
        </h3>
      );
    },
    ul: ({ children }: { children: ReactNode }) => (
      <ul style={{ margin: '0 0 0.5em 0', paddingLeft: '1.5em' }}>{children}</ul>
    ),
    ol: ({ children }: { children: ReactNode }) => (
      <ol style={{ margin: '0 0 0.5em 0', paddingLeft: '1.5em' }}>{children}</ol>
    ),
    li: ({ children }: { children: ReactNode }) => {
      const { children: processed, citationChiclets } = processBlockWithCitations(children);
      return (
        <li style={{ marginBottom: '0.25em' }}>
          {processed}
          {citationChiclets}
        </li>
      );
    },
    code: ({ className, children, ...props }: { className?: string; children: ReactNode }) => {
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
    pre: ({ children }: { children: ReactNode }) => (
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
    blockquote: ({ children }: { children: ReactNode }) => (
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
    a: ({ children, href }: { children: ReactNode; href?: string }) => (
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
    table: ({ children }: { children: ReactNode }) => (
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
    th: ({ children }: { children: ReactNode }) => {
      const { children: processed, citationChiclets } = processBlockWithCitations(children);
      return (
        <th
          style={{
            padding: '0.4em 0.6em',
            borderBottom: '2px solid rgba(0, 0, 0, 0.2)',
            textAlign: 'left',
            fontWeight: 600,
          }}
        >
          {processed}
          {citationChiclets}
        </th>
      );
    },
    td: ({ children }: { children: ReactNode }) => {
      const { children: processed, citationChiclets } = processBlockWithCitations(children);
      return (
        <td
          style={{
            padding: '0.4em 0.6em',
            borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
          }}
        >
          {processed}
          {citationChiclets}
        </td>
      );
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [citations]);

  return (
    <ReactMarkdown components={components}>
      {content}
    </ReactMarkdown>
  );
}
