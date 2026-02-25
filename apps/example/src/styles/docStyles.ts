import React from 'react';

/**
 * Shared documentation-style page styles.
 * Used across all example pages for consistent card/code/text presentation.
 */
export const docStyles: Record<string, React.CSSProperties> = {
  // Layout
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '20px',
  },

  // Typography
  title: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '24px',
  },
  subtitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#444',
    marginBottom: '12px',
  },
  text: {
    fontSize: '14px',
    color: '#666',
    lineHeight: '1.6',
    marginBottom: '8px',
  },
  list: {
    fontSize: '14px',
    color: '#666',
    lineHeight: '1.8',
    paddingLeft: '20px',
  },

  // Card variants
  infoCard: {
    background: 'white',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
  definitionCard: {
    background: '#f0fdf4',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    border: '1px solid #bbf7d0',
  },
  annotationsCard: {
    background: '#fefce8',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    border: '1px solid #fde047',
  },
  contextCard: {
    background: '#f0f9ff',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    border: '1px solid #bfdbfe',
  },
  prerequisiteCard: {
    background: '#fef2f2',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    border: '1px solid #fca5a5',
  },
  /** Alias for infoCard — used for comparison tables */
  comparisonCard: {
    background: 'white',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
  /** Card for interactive demo sections */
  demoCard: {
    background: 'white',
    borderRadius: '8px',
    padding: '24px',
    marginBottom: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    border: '1px solid #e5e7eb',
  },

  // Inline code
  code: {
    background: '#e5e7eb',
    padding: '2px 6px',
    borderRadius: '3px',
    fontSize: '13px',
    fontFamily: 'monospace',
    color: '#1f2937',
  },

  // Code blocks
  codeBlock: {
    background: '#1f2937',
    borderRadius: '6px',
    padding: '16px',
    marginTop: '12px',
    marginBottom: '12px',
    overflow: 'auto',
  },
  pre: {
    margin: 0,
    fontSize: '13px',
    color: '#e5e7eb',
    fontFamily: 'monospace',
    lineHeight: '1.5',
  },

  // Tables
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '14px',
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: '2px solid #e5e7eb',
    color: '#374151',
    fontWeight: '600',
  },
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid #e5e7eb',
    color: '#666',
  },
  /** Alternating row background for tables */
  tdAlt: {
    padding: '10px 12px',
    borderBottom: '1px solid #e5e7eb',
    color: '#666',
    background: '#f9fafb',
  },
};
