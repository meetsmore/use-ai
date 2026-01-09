import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { UseAIProvider, UseAIProviderProps } from '../src/providers/useAIProvider';

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  providerProps?: Partial<UseAIProviderProps>;
}

const defaultProviderProps: UseAIProviderProps = {
  serverUrl: 'ws://localhost:8081',
  children: null,
};

export function renderWithProvider(
  ui: ReactElement,
  options?: CustomRenderOptions
) {
  const { providerProps = {}, ...renderOptions } = options || {};

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <UseAIProvider {...defaultProviderProps} {...providerProps}>
      {children}
    </UseAIProvider>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

export * from '@testing-library/react';
export { renderWithProvider as render };
