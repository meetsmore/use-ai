import React from 'react';
import type { ChatSlotProps } from './types';

interface SlotProps<P extends ChatSlotProps> {
  /** The host's replacement for this region, if it supplied one. */
  component?: React.ComponentType<P>;
  /** The built-in implementation, handed to the override as `children`. */
  fallback: React.ComponentType<P>;
  props: Omit<P, 'children'>;
}

/**
 * Renders one region of the chat, preferring the host's component over the
 * built-in one.
 *
 * The built-in implementation is passed to an override as `children` so it can
 * be decorated rather than replaced. It is created as an element, not rendered,
 * so an override that ignores `children` costs nothing.
 *
 * @internal
 */
export function Slot<P extends ChatSlotProps>({
  component: Override,
  fallback: Fallback,
  props,
}: SlotProps<P>) {
  const built = React.createElement(Fallback, props as P);
  if (!Override) return built;
  return React.createElement(Override, { ...props, children: built } as P);
}
