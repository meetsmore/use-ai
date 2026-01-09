import { createContext, useContext } from "react";

/**
 * Default theme configuration for the chat UI.
 * All colors support CSS color values (hex, rgb, hsl, gradients, etc.)
 */
export const defaultTheme = {
  // Primary colors
  /** Primary color for buttons, links, active states */
  primaryColor: '#667eea',
  /** Primary gradient for user messages and buttons */
  primaryGradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  /** Translucent primary color for overlays (e.g., drop zone) */
  primaryColorTranslucent: 'rgba(102, 126, 234, 0.15)',

  // Backgrounds
  /** Panel background color */
  backgroundColor: 'white',
  /** Assistant message bubble background */
  assistantMessageBackground: '#f3f4f6',
  /** Hover background for buttons and items */
  hoverBackground: '#f3f4f6',
  /** Active/selected item background */
  activeBackground: '#f0f0ff',
  /** Disabled button background */
  buttonDisabledBackground: '#e5e7eb',

  // Text colors
  /** Primary text color */
  textColor: '#1f2937',
  /** Secondary/muted text color */
  secondaryTextColor: '#6b7280',
  /** Placeholder text color */
  placeholderTextColor: '#9ca3af',

  // Status colors
  /** Online status indicator color */
  onlineColor: '#10b981',
  /** Offline status indicator color */
  offlineColor: '#6b7280',
  /** Unread notification indicator color */
  unreadIndicatorColor: '#ff4444',

  // Error/danger colors
  /** Error message background */
  errorBackground: '#fee2e2',
  /** Error message text color */
  errorTextColor: '#dc2626',
  /** Danger/destructive action color (e.g., delete) */
  dangerColor: '#ef4444',

  // Borders and dividers
  /** Border color for dividers and inputs */
  borderColor: '#e5e7eb',
  /** Dashed border color (e.g., file placeholder) */
  dashedBorderColor: '#d1d5db',

  // Shadows
  /** Panel box shadow */
  panelShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
  /** Dropdown box shadow */
  dropdownShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
  /** Button box shadow */
  buttonShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  /** Button hover box shadow */
  buttonHoverShadow: '0 6px 16px rgba(0, 0, 0, 0.2)',

  // Typography
  /** Font family */
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',

  // Backdrop
  /** Modal backdrop color */
  backdropColor: 'rgba(0, 0, 0, 0.3)',
};

/**
 * Theme configuration for the chat UI.
 */
export type UseAITheme = typeof defaultTheme;

export const ThemeContext = createContext<UseAITheme>(defaultTheme);

/**
 * Hook to access the current theme.
 * Returns the theme from UseAIProvider, or defaults if not inside a provider.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const theme = useTheme();
 *   return <div style={{ color: theme.primaryColor }}>Hello</div>;
 * }
 * ```
 */
export function useTheme(): UseAITheme {
  return useContext(ThemeContext);
}
