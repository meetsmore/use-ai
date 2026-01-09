import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { SavedCommand } from '../commands/types';
import { validateCommandName } from '../commands/types';
import { CommandAutocomplete, getFilteredCommandsCount } from '../components/CommandAutocomplete';
import { useTheme, useStrings } from '../theme';

const MAX_VISIBLE_ITEMS = 8;

/**
 * Options for the useSlashCommands hook.
 */
export interface UseSlashCommandsOptions {
  /** List of saved slash commands */
  commands: SavedCommand[];
  /** Callback when a command is selected (via click or keyboard) */
  onCommandSelect?: (text: string) => void;
  /** Callback to save a new command */
  onSaveCommand?: (name: string, text: string) => Promise<string>;
  /** Callback to rename an existing command */
  onRenameCommand?: (id: string, newName: string) => Promise<void>;
  /** Callback to delete a command */
  onDeleteCommand?: (id: string) => Promise<void>;
}

/**
 * Props for the inline save UI component.
 */
export interface InlineSaveProps {
  /** The message ID being saved */
  messageId: string;
  /** The text content of the message */
  messageText: string;
}

/**
 * Return value from the useSlashCommands hook.
 */
export interface UseSlashCommandsReturn {
  /** Whether the autocomplete dropdown is visible */
  isAutocompleteVisible: boolean;

  /**
   * Process input changes to detect slash command prefix.
   * Returns true if the input starts with '/' and autocomplete was triggered.
   */
  handleInputChange: (value: string) => boolean;

  /**
   * Process keyboard events for autocomplete navigation.
   * Returns true if the event was handled by the hook.
   * When a command is selected via Enter, onCommandSelect will be called.
   */
  handleKeyDown: (e: React.KeyboardEvent) => boolean;

  /**
   * Manually close the autocomplete dropdown.
   */
  closeAutocomplete: () => void;

  /**
   * Renders the autocomplete dropdown component.
   * Returns null if autocomplete should not be shown.
   */
  AutocompleteComponent: React.ReactNode;

  /**
   * Start saving a message as a slash command.
   */
  startSavingCommand: (messageId: string, messageText: string) => void;

  /**
   * Check if a specific message is currently being saved as a command.
   */
  isSavingCommand: (messageId: string) => boolean;

  /**
   * Cancel the inline save operation.
   */
  cancelInlineSave: () => void;

  /**
   * Renders the inline save UI component for a specific message.
   * Returns null if not saving for this message.
   */
  renderInlineSaveUI: (props: InlineSaveProps) => React.ReactNode;
}

/**
 * Composable hook for slash commands functionality.
 * Manages autocomplete state, keyboard navigation, and inline save operations.
 *
 * @example
 * ```tsx
 * const {
 *   isAutocompleteVisible,
 *   handleInputChange,
 *   handleKeyDown,
 *   AutocompleteComponent,
 *   startSavingCommand,
 *   isSavingCommand,
 *   renderInlineSaveUI,
 * } = useSlashCommands({
 *   commands,
 *   onCommandSelect: (text) => setInput(text),
 *   onSaveCommand,
 *   onDeleteCommand,
 * });
 *
 * // In your input handler
 * const onInputChange = (e) => {
 *   const value = e.target.value;
 *   setInput(value);
 *   handleInputChange(value);
 * };
 *
 * // In your keydown handler
 * const onKeyDown = (e) => {
 *   if (handleKeyDown(e)) {
 *     return; // Event was handled by slash commands
 *   }
 *   // Handle other key events...
 * };
 *
 * // Render
 * return (
 *   <div style={{ position: 'relative' }}>
 *     {AutocompleteComponent}
 *     <textarea ... />
 *   </div>
 * );
 * ```
 */
export function useSlashCommands({
  commands,
  onCommandSelect,
  onSaveCommand,
  onRenameCommand,
  onDeleteCommand,
}: UseSlashCommandsOptions): UseSlashCommandsReturn {
  const strings = useStrings();
  const theme = useTheme();
  // Autocomplete state
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [searchPrefix, setSearchPrefix] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Inline save state
  const [savingMessageId, setSavingMessageId] = useState<string | null>(null);
  const [savingMessageText, setSavingMessageText] = useState<string>('');
  const [commandNameInput, setCommandNameInput] = useState('');
  const [commandSaveError, setCommandSaveError] = useState<string | null>(null);
  const commandNameInputRef = useRef<HTMLInputElement>(null);

  // Focus command name input when save UI appears
  useEffect(() => {
    if (savingMessageId) {
      setTimeout(() => commandNameInputRef.current?.focus(), 0);
    }
  }, [savingMessageId]);

  /**
   * Handle command selection.
   */
  const selectCommand = useCallback((command: SavedCommand) => {
    setShowAutocomplete(false);
    onCommandSelect?.(command.text);
  }, [onCommandSelect]);

  /**
   * Handle input change to detect slash command prefix.
   */
  const handleInputChange = useCallback((value: string): boolean => {
    if (value.startsWith('/') && commands.length > 0) {
      setSearchPrefix(value.slice(1));
      setShowAutocomplete(true);
      setHighlightedIndex(0);
      return true;
    } else {
      setShowAutocomplete(false);
      return false;
    }
  }, [commands.length]);

  /**
   * Handle keyboard navigation for autocomplete.
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (!showAutocomplete) {
      return false;
    }

    const filteredCount = getFilteredCommandsCount(commands, searchPrefix);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(i => Math.min(i + 1, filteredCount - 1));
      return true;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, 0));
      return true;
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const filteredCommands = commands
        .filter(c => c.name.toLowerCase().startsWith(searchPrefix.toLowerCase()))
        .slice(0, MAX_VISIBLE_ITEMS);
      if (filteredCommands[highlightedIndex]) {
        selectCommand(filteredCommands[highlightedIndex]);
      }
      return true;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowAutocomplete(false);
      return true;
    }

    return false;
  }, [showAutocomplete, commands, searchPrefix, highlightedIndex, selectCommand]);

  /**
   * Close the autocomplete dropdown.
   */
  const closeAutocomplete = useCallback(() => {
    setShowAutocomplete(false);
  }, []);

  /**
   * Handle delete command from autocomplete.
   */
  const handleDeleteCommand = useCallback((command: SavedCommand) => {
    if (onDeleteCommand) {
      onDeleteCommand(command.id);
    }
  }, [onDeleteCommand]);

  /**
   * Start saving a message as a command.
   */
  const startSavingCommand = useCallback((messageId: string, messageText: string) => {
    const existingCommand = commands.find(c => c.text === messageText);
    setSavingMessageId(messageId);
    setSavingMessageText(messageText);
    setCommandNameInput(existingCommand?.name || '');
    setCommandSaveError(null);
  }, [commands]);

  /**
   * Check if a message is being saved.
   */
  const isSavingCommand = useCallback((messageId: string): boolean => {
    return savingMessageId === messageId;
  }, [savingMessageId]);

  /**
   * Cancel inline save operation.
   */
  const cancelInlineSave = useCallback(() => {
    setSavingMessageId(null);
    setSavingMessageText('');
    setCommandNameInput('');
    setCommandSaveError(null);
  }, []);

  /**
   * Handle inline save command submission.
   */
  const handleInlineSaveCommand = useCallback(async () => {
    if (!savingMessageId || !savingMessageText.trim()) return;

    const name = commandNameInput.trim();

    // Validate name
    const validationError = validateCommandName(name);
    if (validationError) {
      setCommandSaveError(validationError);
      return;
    }

    // Check if this message text already exists as a command
    const existingCommand = commands.find(c => c.text === savingMessageText);

    if (existingCommand) {
      // Renaming existing command
      if (existingCommand.name === name) {
        // Name unchanged, just close
        cancelInlineSave();
        return;
      }

      // Check if new name conflicts with another command
      if (commands.some(c => c.name === name && c.id !== existingCommand.id)) {
        setCommandSaveError(strings.commands.commandNameExists);
        return;
      }

      if (!onRenameCommand) {
        setCommandSaveError(strings.commands.renameNotSupported);
        return;
      }

      try {
        await onRenameCommand(existingCommand.id, name);
        cancelInlineSave();
      } catch (err) {
        setCommandSaveError(err instanceof Error ? err.message : strings.commands.renameFailed);
      }
    } else {
      // Creating new command
      if (commands.some(c => c.name === name)) {
        setCommandSaveError(strings.commands.commandNameExists);
        return;
      }

      if (!onSaveCommand) {
        setCommandSaveError(strings.commands.saveNotSupported);
        return;
      }

      try {
        await onSaveCommand(name, savingMessageText);
        cancelInlineSave();
      } catch (err) {
        setCommandSaveError(err instanceof Error ? err.message : strings.commands.saveFailed);
      }
    }
  }, [savingMessageId, savingMessageText, commandNameInput, commands, onRenameCommand, onSaveCommand, cancelInlineSave, strings]);

  /**
   * Render the autocomplete dropdown.
   */
  const AutocompleteComponent = showAutocomplete && commands.length > 0 ? (
    <CommandAutocomplete
      commands={commands}
      searchPrefix={searchPrefix}
      highlightedIndex={highlightedIndex}
      onSelect={selectCommand}
      onDelete={onDeleteCommand ? handleDeleteCommand : undefined}
      onHighlightChange={setHighlightedIndex}
      onClose={closeAutocomplete}
    />
  ) : null;

  /**
   * Render the inline save UI for a specific message.
   */
  const renderInlineSaveUI = useCallback(({ messageId, messageText }: InlineSaveProps): React.ReactNode => {
    if (savingMessageId !== messageId) {
      return null;
    }

    return (
      <div
        data-testid="inline-save-command"
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: '6px 10px',
          background: theme.hoverBackground,
          borderRadius: '0 0 12px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: theme.primaryColor, fontSize: '13px', fontWeight: 500 }}>/</span>
          <input
            ref={commandNameInputRef}
            data-testid="command-name-input"
            type="text"
            value={commandNameInput}
            onChange={(e) => {
              setCommandNameInput(e.target.value);
              setCommandSaveError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleInlineSaveCommand();
              } else if (e.key === 'Escape') {
                cancelInlineSave();
              }
            }}
            placeholder={strings.commands.commandNamePlaceholder}
            style={{
              flex: 1,
              border: commandSaveError ? `1px solid ${theme.dangerColor}` : `1px solid ${theme.borderColor}`,
              borderRadius: '6px',
              padding: '5px 8px',
              fontSize: '13px',
              outline: 'none',
              background: theme.backgroundColor,
              minWidth: 0,
            }}
          />
          <button
            data-testid="save-command-confirm"
            onClick={handleInlineSaveCommand}
            disabled={!commandNameInput.trim()}
            style={{
              padding: '5px',
              border: 'none',
              borderRadius: '6px',
              background: 'transparent',
              color: commandNameInput.trim() ? theme.primaryColor : theme.dashedBorderColor,
              cursor: commandNameInput.trim() ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={strings.commands.saveCommand}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
          </button>
        </div>
        {commandSaveError && (
          <div
            data-testid="command-save-error"
            style={{
              fontSize: '11px',
              color: theme.dangerColor,
              paddingLeft: '2px',
            }}
          >
            {commandSaveError}
          </div>
        )}
      </div>
    );
  }, [savingMessageId, commandNameInput, commandSaveError, handleInlineSaveCommand, cancelInlineSave, theme, strings]);

  return {
    isAutocompleteVisible: showAutocomplete,
    handleInputChange,
    handleKeyDown,
    closeAutocomplete,
    AutocompleteComponent,
    startSavingCommand,
    isSavingCommand,
    cancelInlineSave,
    renderInlineSaveUI,
  };
}
