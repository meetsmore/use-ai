import React, { useRef } from 'react';

/**
 * Props for the FeedbackButton component.
 */
interface FeedbackButtonProps {
  /** The type of feedback this button represents */
  type: 'upvote' | 'downvote';
  /** Whether this feedback type is currently selected */
  isSelected: boolean;
  /** Callback when clicked */
  onClick: () => void;
  /** Color when selected */
  selectedColor: string;
  /** Color when not selected */
  unselectedColor: string;
}

/**
 * Thumbs up/down feedback button with pop animation.
 */
export function FeedbackButton({ type, isSelected, onClick, selectedColor, unselectedColor }: FeedbackButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = () => {
    // Pop animation only on select, not de-select
    if (!isSelected && buttonRef.current) {
      buttonRef.current.style.transform = 'scale(1.3)';
      setTimeout(() => {
        if (buttonRef.current) {
          buttonRef.current.style.transform = 'scale(1)';
        }
      }, 150);
    }
    onClick();
  };

  const thumbsUpPath = "M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3";
  const thumbsDownPath = "M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17";

  return (
    <button
      ref={buttonRef}
      data-testid={`feedback-${type}`}
      onClick={handleClick}
      title={type === 'upvote' ? 'Good response' : 'Poor response'}
      style={{
        background: 'transparent',
        border: 'none',
        padding: '4px',
        cursor: 'pointer',
        color: isSelected ? selectedColor : unselectedColor,
        opacity: isSelected ? 1 : 0.5,
        transition: 'all 0.15s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '4px',
        transform: 'scale(1)',
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
        if (!isSelected) {
          e.currentTarget.style.opacity = '0.8';
          e.currentTarget.style.color = selectedColor;
        }
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
        if (!isSelected) {
          e.currentTarget.style.opacity = '0.5';
          e.currentTarget.style.color = unselectedColor;
        }
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill={isSelected ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={type === 'upvote' ? thumbsUpPath : thumbsDownPath} />
      </svg>
    </button>
  );
}
