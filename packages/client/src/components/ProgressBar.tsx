import React from 'react';

/**
 * Props for the CircularProgress component.
 */
export interface ProgressBarProps {
  /** Progress value from 0 to 100 */
  progress: number;
  /** Size of the progress indicator in pixels (default: 16) */
  size?: number;
  /** Color of the progress fill (default: currentColor) */
  color?: string;
  /** Color of the track behind the progress (default: same as color with 0.25 opacity) */
  trackColor?: string;
  /** Stroke width (default: 2) */
  strokeWidth?: number;
}

/**
 * A circular progress indicator component for determinate progress (0-100%).
 * Matches the visual style of Spinner.
 */
export function ProgressBar({
  progress,
  size = 16,
  color = 'currentColor',
  trackColor,
  strokeWidth = 2,
}: ProgressBarProps) {
  const clampedProgress = Math.min(100, Math.max(0, progress));
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - clampedProgress / 100);

  return (
    <svg
      data-testid="progress-bar"
      role="progressbar"
      aria-valuenow={clampedProgress}
      aria-valuemin={0}
      aria-valuemax={100}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{
        transform: 'rotate(-90deg)',
      }}
    >
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
      {/* Progress arc */}
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        style={{
          transition: 'stroke-dashoffset 0.2s ease',
        }}
      />
    </svg>
  );
}
