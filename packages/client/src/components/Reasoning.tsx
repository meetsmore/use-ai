import React, { useState, useCallback } from 'react';
import type { ReasoningPart } from '../types';
import type { UseAITheme, UseAIStrings } from '../theme';

/**
 * Inline SVG icons to avoid external icon library dependencies.
 */
function BrainIcon({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}

function ChevronIcon({ color, size = 16, rotated }: { color: string; size?: number; rotated: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flexShrink: 0,
        transition: 'transform 200ms ease',
        transform: rotated ? 'rotate(180deg)' : 'rotate(0deg)',
      }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export interface ReasoningProps {
  /** Every step's reasoning, whether the run is still in flight or persisted. */
  reasoningParts: ReasoningPart[];
  isStreaming?: boolean;
  theme: UseAITheme;
  strings: UseAIStrings;
}

export function Reasoning({
  reasoningParts,
  isStreaming = false,
  theme,
  strings,
}: ReasoningProps) {
  const [isOpen, setIsOpen] = useState(false);

  const toggle = useCallback(() => setIsOpen(prev => !prev), []);

  const allText = reasoningParts.map(p => p.text).join('\n\n');

  const headerContent = isStreaming
    ? <ShimmerText text={strings.thinking.inProgress} theme={theme} />
    : <span>{strings.thinking.complete}</span>;

  return (
    <div data-testid="thinking-timeline" style={{ marginBottom: '8px' }}>
      <style>{`
        @keyframes use-ai-shimmer {
          from { background-position: 100% center; }
          to { background-position: 0% center; }
        }
        @keyframes use-ai-reasoning-open {
          from { opacity: 0; max-height: 0; }
          to { opacity: 1; max-height: 2000px; }
        }
      `}</style>
      {/* Trigger */}
      <button
        data-testid="thinking-toggle"
        onClick={toggle}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 0',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          color: theme.secondaryTextColor,
          fontSize: '14px',
          fontFamily: 'inherit',
          lineHeight: '1.5',
        }}
      >
        <BrainIcon color={theme.secondaryTextColor} size={16} />
        {headerContent}
        <ChevronIcon color={theme.secondaryTextColor} size={16} rotated={isOpen} />
      </button>

      {/* Collapsible content */}
      {isOpen && allText && (
        <div
          data-testid="thinking-content"
          style={{
            animation: 'use-ai-reasoning-open 200ms ease-out forwards',
            overflow: 'hidden',
            marginTop: '4px',
            paddingLeft: '4px',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              background: 'transparent',
              borderLeft: `2px solid ${theme.borderColor}`,
              fontSize: '14px',
              lineHeight: '1.6',
              color: theme.secondaryTextColor,
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
            }}
          >
            {allText}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Text with a shimmer (light sweep) animation, implemented with pure CSS.
 * Mimics the AI Elements Shimmer component without motion/react dependency.
 */
function ShimmerText({ text, theme }: { text: string; theme: UseAITheme }) {
  const spread = text.length * 2;
  return (
    <span
      style={{
        display: 'inline-block',
        backgroundSize: '250% 100%',
        backgroundRepeat: 'no-repeat, padding-box',
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        color: 'transparent',
        backgroundImage: `linear-gradient(90deg, transparent calc(50% - ${spread}px), ${theme.backgroundColor}, transparent calc(50% + ${spread}px)), linear-gradient(${theme.secondaryTextColor}, ${theme.secondaryTextColor})`,
        animation: 'use-ai-shimmer 2s linear infinite',
      }}
    >
      {text}
    </span>
  );
}

Reasoning.displayName = 'Reasoning';
