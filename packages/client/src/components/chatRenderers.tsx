import { createContext, useContext } from 'react';
import type React from 'react';

/** Props for a component that renders one fenced code block in an answer. */
export interface ChatCodeBlockRendererProps {
  /** The block's source, without the fences and the trailing newline. */
  code: string;
  /**
   * The language on the opening fence, e.g. `"viz"` for a block opened with
   * ```` ```viz ````.
   */
  language: string;
  /**
   * Whether the closing fence has arrived. While an answer streams, an
   * unclosed fence runs to the end of the text, so `code` grows token by token
   * until this turns true. Render progressively or wait, as the block allows.
   */
  complete: boolean;
}

/**
 * How things inside an answer are drawn, as opposed to `chatComponents`, which
 * replaces whole regions of the chat UI.
 */
export interface UseAIChatRenderers {
  /**
   * Renders fenced code blocks by their language instead of as plain code. A
   * registered language replaces the whole `<pre>`; any other language keeps
   * the built-in rendering.
   *
   * Define the components at module level. A component created during render
   * is a new type each time, so React remounts the block on every streamed
   * token and anything inside it (a chart, a selection) is thrown away.
   *
   * @example
   * ```tsx
   * const codeBlocks = { viz: VizBlock };
   * <UseAIProvider chatRenderers={{ codeBlocks }} />
   * ```
   */
  codeBlocks?: Record<string, React.ComponentType<ChatCodeBlockRendererProps>>;
}

const EMPTY_RENDERERS: UseAIChatRenderers = {};

/**
 * Carries `chatRenderers` from `UseAIProvider` to wherever an answer is drawn.
 * It is a context rather than a prop so the renderers also apply when a custom
 * `Message` slot renders `DefaultMessage` or `MarkdownContent` itself.
 */
export const ChatRenderersContext = createContext<UseAIChatRenderers>(EMPTY_RENDERERS);

export function useChatRenderers(): UseAIChatRenderers {
  return useContext(ChatRenderersContext);
}
