import React from 'react';
import { describe, test, expect, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { UseAIChatPanel } from './UseAIChatPanel';
import type {
  ChatComposerSlotProps,
  ChatDisclaimerSlotProps,
  ChatEmptyStateSlotProps,
  ChatHeaderSlotProps,
  ChatMessageSlotProps,
  ChatPendingIndicatorSlotProps,
  ChatToolApprovalSlotProps,
  UseAIChatComponentOverrides,
} from './chatSlots';
import type { PersistedMessage } from '../providers/chatRepository/types';

const message: PersistedMessage = {
  id: 'message-1',
  role: 'assistant',
  content: 'Built-in message',
  createdAt: new Date(0),
};

function renderPanel(
  components?: UseAIChatComponentOverrides,
  overrides: Partial<React.ComponentProps<typeof UseAIChatPanel>> = {}
) {
  return render(
    <UseAIChatPanel
      onSendMessage={mock(() => {})}
      messages={[message]}
      loading
      connected
      streamingText="Streaming"
      pendingApprovals={[{
        toolCallId: 'tool-1',
        toolCallName: 'fillForm',
        toolCallArgs: { field: 'name' },
      }]}
      onApproveToolCall={mock(() => {})}
      onRejectToolCall={mock(() => {})}
      components={components}
      {...overrides}
    />
  );
}

describe('UseAIChat component slots', () => {
  test('keeps the built-in UI when no overrides are provided', () => {
    const { getByText, getByTestId } = renderPanel();

    expect(getByText('Built-in message')).toBeInTheDocument();
    expect(getByText('Streaming')).toBeInTheDocument();
    expect(getByTestId('chat-message-assistant')).toBeInTheDocument();
    expect(getByTestId('chat-message-assistant-streaming')).toBeInTheDocument();
  });

  test('replaces all populated chat regions and exposes their state', () => {
    const onApproveToolCall = mock(() => {});
    const onRejectToolCall = mock((_reason?: string) => {});
    const Header = ({ currentChatId }: ChatHeaderSlotProps) => (
      <div data-testid="custom-header">{currentChatId}</div>
    );
    const Message = ({ message: slotMessage, streaming }: ChatMessageSlotProps) => (
      <div data-testid="custom-message" data-streaming={String(streaming)}>
        {slotMessage.content as string}
      </div>
    );
    const ToolApproval = ({ approvals, onApprove, onReject }: ChatToolApprovalSlotProps) => (
      <div data-testid="custom-approval">
        {approvals[0].toolCallName}
        <button data-testid="custom-approve" onClick={onApprove}>Approve</button>
        <button data-testid="custom-reject" onClick={() => onReject('Not now')}>Reject</button>
      </div>
    );
    // A full replacement intentionally omits children. ToolApproval must still
    // render because approval controls are required to resume the pending run.
    const Composer = ({ pendingApprovals }: ChatComposerSlotProps) => (
      <div data-testid="custom-composer" data-pending={pendingApprovals.length} />
    );
    const Disclaimer = ({ text }: ChatDisclaimerSlotProps) => (
      <div data-testid="custom-disclaimer">Notice: {text}</div>
    );

    const { getAllByTestId, getByTestId, queryByTestId } = renderPanel(
      { Header, Message, ToolApproval, Composer, Disclaimer },
      {
        currentChatId: 'chat-custom',
        onApproveToolCall,
        onRejectToolCall,
        enabledFeatures: { inputDisclaimer: true },
      }
    );

    expect(getByTestId('custom-header')).toHaveTextContent('chat-custom');
    // Both the persisted message and the streaming answer go through Message.
    const messages = getAllByTestId('custom-message');
    expect(messages).toHaveLength(2);
    expect(messages[0]).toHaveTextContent('Built-in message');
    expect(messages[1]).toHaveTextContent('Streaming');
    expect(getByTestId('custom-approval')).toHaveTextContent('fillForm');
    expect(getByTestId('custom-composer')).toHaveAttribute('data-pending', '1');
    expect(getByTestId('custom-disclaimer')).toHaveTextContent('AI can make mistakes');
    expect(queryByTestId('chat-message-assistant')).toBeNull();
    expect(queryByTestId('chat-message-assistant-streaming')).toBeNull();

    fireEvent.click(getByTestId('custom-approve'));
    fireEvent.click(getByTestId('custom-reject'));
    expect(onApproveToolCall).toHaveBeenCalledTimes(1);
    expect(onRejectToolCall).toHaveBeenCalledWith('Not now');
  });

  test('routes the streaming answer through the Message slot', () => {
    const Message = ({ message: slotMessage, streaming, streamingReasoning, streamingParts, isLast }: ChatMessageSlotProps) => (
      <div
        data-testid={`slot-${slotMessage.id}`}
        data-streaming={String(streaming)}
        data-reasoning={streamingReasoning}
        data-parts={streamingParts.map((part) => part.kind).join(',')}
        data-last={String(isLast)}
      >
        {slotMessage.content as string}
      </div>
    );

    const { getByTestId } = renderPanel(
      { Message },
      {
        streamingMessageId: 'message-2',
        streamingReasoning: 'Weighing options',
        streamingParts: [
          { kind: 'reasoning', text: 'Weighing options' },
          { kind: 'tool_call', toolCallId: 'tc1', name: 'search', args: '{}' },
        ],
      }
    );

    const persisted = getByTestId('slot-message-1');
    expect(persisted).toHaveAttribute('data-streaming', 'false');
    expect(persisted).toHaveAttribute('data-reasoning', '');
    expect(persisted).toHaveAttribute('data-parts', '');
    expect(persisted).toHaveAttribute('data-last', 'false');

    // The provisional entry carries the id the answer will be persisted under,
    // so the slot keeps the same instance when the run finishes.
    const streamingBubble = getByTestId('slot-message-2');
    expect(streamingBubble).toHaveTextContent('Streaming');
    expect(streamingBubble).toHaveAttribute('data-streaming', 'true');
    expect(streamingBubble).toHaveAttribute('data-reasoning', 'Weighing options');
    // The ordered parts let a slot keep the run's steps apart while it streams.
    expect(streamingBubble).toHaveAttribute('data-parts', 'reasoning,tool_call');
    expect(streamingBubble).toHaveAttribute('data-last', 'true');
  });

  const PendingIndicator = ({ executingTool }: ChatPendingIndicatorSlotProps) => (
    <div data-testid="custom-pending">{executingTool?.displayText}</div>
  );
  const executingTool = { toolCallId: 'tool-1', name: 'fillForm', displayText: 'Filling the form' };

  test('renders PendingIndicator before the answer starts arriving', () => {
    const { getByTestId } = renderPanel(
      { PendingIndicator },
      { streamingText: '', executingTool }
    );

    expect(getByTestId('custom-pending')).toHaveTextContent('Filling the form');
  });

  test('drops PendingIndicator once the answer starts arriving', () => {
    const { queryByTestId } = renderPanel({ PendingIndicator }, { executingTool });

    expect(queryByTestId('custom-pending')).toBeNull();
  });

  test('lets EmptyState send a suggestion', () => {
    const onSendMessage = mock(() => {});
    const EmptyState = ({ suggestions, onSelectSuggestion }: ChatEmptyStateSlotProps) => (
      <button data-testid="custom-empty" onClick={() => onSelectSuggestion(suggestions[0])}>
        {suggestions[0]}
      </button>
    );

    const { getByTestId } = renderPanel(
      { EmptyState },
      {
        messages: [],
        loading: false,
        suggestions: ['Explain this page'],
        pendingApprovals: [],
        onSendMessage,
      }
    );

    fireEvent.click(getByTestId('custom-empty'));
    expect(onSendMessage).toHaveBeenCalledWith('Explain this page');
  });

  test('lets a custom Composer control input and submission', () => {
    const onSendMessage = mock(() => {});
    const Composer = ({ input, onInputChange, onSend, canSend }: ChatComposerSlotProps) => (
      <div>
        <span data-testid="custom-input-value">{input}</span>
        <button data-testid="custom-set-input" onClick={() => onInputChange('Hello')}>Set</button>
        <button data-testid="custom-send" disabled={!canSend} onClick={onSend}>Send</button>
      </div>
    );

    const { getByTestId } = renderPanel(
      { Composer },
      {
        messages: [],
        loading: false,
        pendingApprovals: [],
        onSendMessage,
      }
    );

    fireEvent.click(getByTestId('custom-set-input'));
    expect(getByTestId('custom-input-value')).toHaveTextContent('Hello');
    expect(getByTestId('custom-send')).not.toBeDisabled();
    fireEvent.click(getByTestId('custom-send'));

    expect(onSendMessage).toHaveBeenCalledWith('Hello', undefined);
  });
});
