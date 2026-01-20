import React from 'react';

/**
 * Props for the Spinner component.
 */
export interface SpinnerProps {
  /** Size of the spinner in pixels (default: 16) */
  size?: number;
  /** Color of the spinner (default: currentColor) */
  color?: string;
  /** Color of the track behind the spinner (default: same as color with 0.25 opacity) */
  trackColor?: string;
  /** Stroke width (default: 2) */
  strokeWidth?: number;
}

/**
 * A circular spinner component for indeterminate progress.
 * Matches the visual style of CircularProgress.
 */
export function Spinner({
  size = 16,
  color = 'currentColor',
  trackColor,
  strokeWidth = 2,
}: SpinnerProps) {
  const radius = 10;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      data-testid="spinner"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{
        animation: 'use-ai-spin 1s linear infinite',
      }}
    >
      <style>
        {`
          @keyframes use-ai-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
      {/* Background track */}
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke={trackColor || color}
        strokeWidth={strokeWidth}
        opacity={trackColor ? 1 : 0.25}
      />
      {/* Spinning arc (25% of circle) */}
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * 0.75}
        style={{
          transformOrigin: 'center',
        }}
      />
    </svg>
  );
}
