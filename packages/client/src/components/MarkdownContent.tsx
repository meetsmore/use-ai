import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useChatRenderers, type ChatCodeBlockRendererProps } from './chatRenderers';

interface MarkdownContentProps {
  content: string;
}

const REMARK_PLUGINS = [remarkGfm];

/** The parts of a hast node that a fenced code block needs. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

/** Reads the language and source of a `<pre><code class="language-x">` block. */
function readCodeBlock(pre: HastNode | undefined): { language: string; code: string } | null {
  const code = pre?.children?.find((child) => child.type === 'element' && child.tagName === 'code');
  const classNames = code?.properties?.className;
  if (!code || !Array.isArray(classNames)) return null;
  const languageClass = classNames.find(
    (name): name is string => typeof name === 'string' && name.startsWith('language-'),
  );
  if (!languageClass) return null;
  return {
    language: languageClass.slice('language-'.length),
    // The fenced block's text always ends with the newline before the closing
    // fence (or before the end of an unclosed one).
    code: textOf(code).replace(/\n$/, ''),
  };
}

const PRE_STYLE: React.CSSProperties = {
  margin: '0.5em 0',
  padding: '0.75em',
  backgroundColor: 'rgba(0, 0, 0, 0.1)',
  borderRadius: '6px',
  overflow: 'auto',
  fontSize: '0.85em',
  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
};

interface CodeBlockErrorBoundaryProps extends ChatCodeBlockRendererProps {
  Renderer: React.ComponentType<ChatCodeBlockRendererProps>;
  fallback: React.ReactNode;
}

type CodeBlockErrorBoundaryState = Pick<CodeBlockErrorBoundaryProps, 'code' | 'language' | 'Renderer'> & {
  hasError: boolean;
};

/** Isolates renderer errors and retries on new input without remounting healthy blocks. */
class CodeBlockErrorBoundary extends React.Component<CodeBlockErrorBoundaryProps, CodeBlockErrorBoundaryState> {
  state: CodeBlockErrorBoundaryState = {
    code: this.props.code,
    language: this.props.language,
    Renderer: this.props.Renderer,
    hasError: false,
  };

  static getDerivedStateFromProps(
    props: CodeBlockErrorBoundaryProps,
    state: CodeBlockErrorBoundaryState,
  ): CodeBlockErrorBoundaryState | null {
    if (props.code !== state.code || props.language !== state.language || props.Renderer !== state.Renderer) {
      return { code: props.code, language: props.language, Renderer: props.Renderer, hasError: false };
    }
    return null;
  }

  static getDerivedStateFromError(): Partial<CodeBlockErrorBoundaryState> {
    return { hasError: true };
  }

  render() {
    const { Renderer, code, language, fallback } = this.props;
    return this.state.hasError ? fallback : <Renderer code={code} language={language} />;
  }
}

/**
 * A fenced code block. A language registered in `chatRenderers.codeBlocks`
 * replaces the whole `<pre>`; anything else keeps the built-in look.
 *
 * Declared once at module level like the rest of `MARKDOWN_COMPONENTS`: it
 * reads the renderers from context instead of closing over them, so the map
 * never changes identity (see below).
 */
function CodeBlock({ node, children }: { node?: HastNode; children?: React.ReactNode }) {
  const { codeBlocks } = useChatRenderers();
  const block = codeBlocks ? readCodeBlock(node) : null;
  const Renderer = block && codeBlocks && Object.hasOwn(codeBlocks, block.language)
    ? codeBlocks[block.language]
    : undefined;
  const fallback = <pre style={PRE_STYLE}>{children}</pre>;
  if (block && Renderer) {
    return <CodeBlockErrorBoundary code={block.code} language={block.language} Renderer={Renderer} fallback={fallback} />;
  }
  return fallback;
}

/**
 * This map must stay a module-level constant.
 *
 * react-markdown re-creates its element tree on every render, and React
 * reconciles that tree by component identity. If the `components` map were
 * built inside the render function, every entry would be a brand new function
 * on each render, so React would unmount and remount the whole subtree instead
 * of updating it. During streaming that happens on every token: the browser
 * throws away and rebuilds the entire answer many times per second, which
 * destroys any text selection the user is making and makes the scroll position
 * jump. Keeping it stable lets React update text nodes in place, so a
 * selection survives the stream.
 */
const MARKDOWN_COMPONENTS: Components = {
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
  pre: CodeBlock as Components['pre'],
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
  // Render images as links to prevent automatic HTTP requests.
  // <img> tags fire GET requests on render, which could be exploited
  // via prompt injection to exfiltrate sensitive data through URLs.
  img: ({ src, alt }) => (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: 'inherit',
        textDecoration: 'underline',
        textUnderlineOffset: '2px',
      }}
    >
      {alt || 'Image'}
    </a>
  ),
};

/**
 * Renders markdown content with appropriate styling for the chat panel.
 *
 * Memoized on `content`: the chat panel re-renders on every streaming token,
 * and without this every message in the history would be re-parsed each time.
 */
export const MarkdownContent = React.memo(function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
      {content}
    </ReactMarkdown>
  );
});
