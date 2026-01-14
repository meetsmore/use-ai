// ============================================================================
// Citation Types
// ============================================================================

/**
 * Custom event name for citation events.
 * Used with AG-UI CustomEvent to transmit citation data.
 */
export const CITATION_EVENT_NAME = 'citation';

/**
 * Unicode Private Use Area delimiters for citation markers.
 * Using PUA characters as delimiters prevents collision with natural text.
 *
 * Format: START + "cite" + SEP + number + END
 * Example: '\ue200cite\ue2021\ue201' for citation 1
 *
 * This format follows the ChatGPT citation style where:
 * - \ue200 marks the start of a citation reference
 * - \ue201 marks the end of a citation reference
 * - \ue202 separates the type from the reference identifier
 * - "cite" and the number are visible text the AI can output
 */
export const CITATION_MARKER_START = '\ue200';
export const CITATION_MARKER_END = '\ue201';
export const CITATION_MARKER_SEP = '\ue202';

/**
 * Pattern to match legacy [n] citation markers in text.
 * Used for backwards compatibility.
 */
export const LEGACY_CITATION_PATTERN = /\[(\d+)\]/g;

/**
 * Pattern to match citation markers in text.
 * Uses Markdown footnote syntax [^n] which Claude outputs naturally and rarely appears in code.
 * Examples: [^1], [^2], [^1,2]
 */
export const CITATION_PATTERN = /\[\^(\d+(?:,\d+)*)\]/g;

/**
 * Creates a citation marker for a given number.
 * @param num The citation number (1, 2, 3, etc.)
 * @returns The marker string (e.g., '[^1]')
 */
export function createCitationMarker(num: number): string {
  return `[^${num}]`;
}

/**
 * Transforms legacy [n] citation markers to footnote format.
 * @param text Text containing [1], [2], etc. markers
 * @returns Text with footnote markers ([^1], [^2], etc.)
 */
export function transformLegacyCitations(text: string): string {
  return text.replace(LEGACY_CITATION_PATTERN, (_, num) => createCitationMarker(parseInt(num, 10)));
}

/**
 * System prompt instruction for AI models to use citation markers.
 * Uses Markdown footnote syntax [^n] which Claude outputs naturally.
 *
 * @example
 * ```typescript
 * new AISDKAgent({
 *   model: anthropic('claude-sonnet-4-20250514'),
 *   providerTools: { web_search: webSearch },
 *   // Citation instruction is auto-appended when citations: true (default)
 * });
 * ```
 */
export const CITATION_SYSTEM_INSTRUCTION = `**CITATION FORMAT (REQUIRED)**
When referencing information from sources, cite using Markdown footnote markers.

Format: [^N] where N is the source number (1-indexed position in results).
Multiple sources: [^1,2]

EXAMPLES:
- "TypeScript 5.7 was released in November 2024[^1]."
- "React 19 introduced new features[^2] and performance improvements[^1,3]."

RULES:
1. Place [^N] IMMEDIATELY after the cited claim.
2. Every fact from sources MUST have a citation marker.`;

/**
 * A citation reference that can be displayed inline as [n] linking to a source.
 */
export interface Citation {
  /** Unique identifier for this citation */
  id: string;
  /** Sequential number for display [1], [2], etc. */
  number: number;
  /** Type of citation source */
  type: 'url' | 'document' | 'tool-result';
  /** URL for web sources (opens in new tab when clicked) */
  url?: string;
  /** Title of the source (used for tooltip) */
  title?: string;
  /** Document ID for RAG sources */
  documentId?: string;
  /** Snippet/excerpt from the source */
  snippet?: string;
  /** Tool name that provided this citation */
  toolName?: string;
  /** Provider-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Event payload for citation custom events.
 * Sent via CustomEvent with name='citation'.
 */
export interface CitationEvent {
  /** The message ID these citations belong to */
  messageId: string;
  /** Array of citations collected so far */
  citations: Citation[];
}
