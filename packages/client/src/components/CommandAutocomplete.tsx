import React, { useEffect, useRef } from 'react';
import type { SavedCommand } from '../commands/types';
import { useTheme, useStrings } from '../theme';

interface CommandAutocompleteProps {
  commands: SavedCommand[];
  searchPrefix: string;
  highlightedIndex: number;
  onSelect: (command: SavedCommand) => void;
  onDelete?: (command: SavedCommand) => void;
  onHighlightChange: (index: number) => void;
  onClose: () => void;
}

const MAX_VISIBLE_ITEMS = 8;

/**
 * Dropdown autocomplete for slash commands.
 * Appears above the input when user types '/'.
 */
export function CommandAutocomplete({
  commands,
  searchPrefix,
  highlightedIndex,
  onSelect,
  onDelete,
  onHighlightChange,
  onClose,
}: CommandAutocompleteProps) {
  const strings = useStrings();
  const theme = useTheme();

  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Filter commands by prefix
  const filteredCommands = commands.filter(c =>
    c.name.toLowerCase().startsWith(searchPrefix.toLowerCase())
  ).slice(0, MAX_VISIBLE_ITEMS);

  // Scroll highlighted item into view
  useEffect(() => {
    const item = itemRefs.current[highlightedIndex];
    if (item && listRef.current) {
      const listRect = listRef.current.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();

      if (itemRect.bottom > listRect.bottom) {
        item.scrollIntoView({ block: 'end' });
      } else if (itemRect.top < listRect.top) {
        item.scrollIntoView({ block: 'start' });
      }
    }
  }, [highlightedIndex]);

  if (filteredCommands.length === 0) {
    return (
      <div
        data-testid="command-autocomplete"
        style={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          right: 0,
          marginBottom: '8px',
          background: theme.backgroundColor,
          borderRadius: '8px',
          boxShadow: theme.dropdownShadow,
          overflow: 'hidden',
          zIndex: 1005,
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            color: theme.secondaryTextColor,
            fontSize: '13px',
            textAlign: 'center',
          }}
        >
          {commands.length === 0
            ? strings.commands.noSavedCommands
            : strings.commands.noMatchingCommands}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="command-autocomplete"
      ref={listRef}
      style={{
        position: 'absolute',
        bottom: '100%',
        left: 0,
        right: 0,
        marginBottom: '8px',
        background: theme.backgroundColor,
        borderRadius: '8px',
        boxShadow: theme.dropdownShadow,
        overflow: 'hidden',
        maxHeight: '320px',
        overflowY: 'auto',
        zIndex: 1005,
      }}
    >
      {filteredCommands.map((cmd, index) => (
        <div
          key={cmd.id}
          ref={el => { itemRefs.current[index] = el; }}
          data-testid="command-autocomplete-item"
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => onHighlightChange(index)}
          style={{
            padding: '10px 14px',
            background: index === highlightedIndex ? theme.hoverBackground : 'transparent',
            cursor: 'pointer',
            borderBottom: index < filteredCommands.length - 1 ? `1px solid ${theme.hoverBackground}` : 'none',
            transition: 'background 0.1s',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: '14px',
                color: theme.primaryColor,
              }}
            >
              /{cmd.name}
            </div>
            <div
              style={{
                marginTop: '4px',
                fontSize: '13px',
                color: theme.secondaryTextColor,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {cmd.text.length > 60 ? cmd.text.substring(0, 60) + '...' : cmd.text}
            </div>
          </div>
          {onDelete && (
            <button
              data-testid="command-delete-button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(cmd);
              }}
              style={{
                padding: '4px',
                background: 'transparent',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                color: theme.placeholderTextColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: '2px',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.currentTarget.style.color = theme.dangerColor;
                e.currentTarget.style.background = theme.errorBackground;
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.currentTarget.style.color = theme.placeholderTextColor;
                e.currentTarget.style.background = 'transparent';
              }}
              title={strings.commands.deleteCommand}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4H14M6.5 7V11M9.5 7V11M3 4L4 13C4 13.5304 4.21071 14.0391 4.58579 14.4142C4.96086 14.7893 5.46957 15 6 15H10C10.5304 15 11.0391 14.7893 11.4142 14.4142C11.7893 14.0391 12 13.5304 12 13L13 4M5.5 4V2.5C5.5 2.23478 5.60536 1.98043 5.79289 1.79289C5.98043 1.60536 6.23478 1.5 6.5 1.5H9.5C9.76522 1.5 10.0196 1.60536 10.2071 1.79289C10.3946 1.98043 10.5 2.23478 10.5 2.5V4" />
              </svg>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Returns the number of filtered commands for keyboard navigation bounds.
 */
export function getFilteredCommandsCount(
  commands: SavedCommand[],
  searchPrefix: string
): number {
  return Math.min(
    commands.filter(c => c.name.toLowerCase().startsWith(searchPrefix.toLowerCase())).length,
    MAX_VISIBLE_ITEMS
  );
}
