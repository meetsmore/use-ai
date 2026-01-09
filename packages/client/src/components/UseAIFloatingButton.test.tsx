import { describe, it, expect, mock } from 'bun:test';
import { render, fireEvent } from '@testing-library/react';
import { UseAIFloatingButton } from './UseAIFloatingButton';

describe('UseAIFloatingButton', () => {
  it('should render the button with "AI" text', () => {
    const onClick = mock(() => {});
    const { getByText } = render(<UseAIFloatingButton onClick={onClick} connected={true} />);

    expect(getByText('AI')).toBeInTheDocument();
  });

  it('should call onClick when button is clicked and connected', () => {
    const onClick = mock(() => {});
    const { getByRole } = render(<UseAIFloatingButton onClick={onClick} connected={true} />);

    const button = getByRole('button');
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('should be disabled when not connected', () => {
    const onClick = mock(() => {});
    const { getByRole } = render(<UseAIFloatingButton onClick={onClick} connected={false} />);

    const button = getByRole('button');
    expect(button).toBeDisabled();
  });

  it('should be enabled when connected', () => {
    const onClick = mock(() => {});
    const { getByRole } = render(<UseAIFloatingButton onClick={onClick} connected={true} />);

    const button = getByRole('button');
    expect(button).toBeEnabled();
  });

  it('should show "Open AI Assistant" title when connected', () => {
    const onClick = mock(() => {});
    const { getByRole } = render(<UseAIFloatingButton onClick={onClick} connected={true} />);

    const button = getByRole('button');
    expect(button).toHaveAttribute('title', 'Open AI Assistant');
  });

  it('should show "Connecting to AI..." title when not connected', () => {
    const onClick = mock(() => {});
    const { getByRole } = render(<UseAIFloatingButton onClick={onClick} connected={false} />);

    const button = getByRole('button');
    expect(button).toHaveAttribute('title', 'Connecting to AI...');
  });

  it('should display unread indicator when hasUnread is true', () => {
    const onClick = mock(() => {});
    const { container } = render(
      <UseAIFloatingButton onClick={onClick} connected={true} hasUnread={true} />
    );

    const indicator = container.querySelector('span');
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveStyle({ background: '#ff4444' });
  });

  it('should not display unread indicator when hasUnread is false', () => {
    const onClick = mock(() => {});
    const { container } = render(
      <UseAIFloatingButton onClick={onClick} connected={true} hasUnread={false} />
    );

    const indicator = container.querySelector('span');
    expect(indicator).not.toBeInTheDocument();
  });

  it('should have correct background color when connected', () => {
    const onClick = mock(() => {});
    const { getByRole } = render(<UseAIFloatingButton onClick={onClick} connected={true} />);

    const button = getByRole('button');
    expect(button).toHaveStyle({
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    });
  });

  it('should have gray background when not connected', () => {
    const onClick = mock(() => {});
    const { getByRole } = render(<UseAIFloatingButton onClick={onClick} connected={false} />);

    const button = getByRole('button');
    expect(button).toHaveStyle({ background: '#6b7280' });
  });
});
