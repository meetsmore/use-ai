import React from 'react';
import { createRoot } from 'react-dom/client';
import { UseAIProvider } from '@meetsmore/use-ai-client';
import App from './App';
import { InvisibleAIProvider } from './providers/InvisibleAIProvider';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

const root = createRoot(container);
root.render(
  <UseAIProvider
    serverUrl="ws://localhost:8081"
    systemPrompt="You are a helpful AI assistant for a demo application. Be concise and friendly in your responses."
    mcpHeadersProvider={() => ({
      'http://localhost:3002': {
        headers: { 'X-API-Key': 'secret-api-key-123' },
      },
    })}
  >
    <InvisibleAIProvider>
      <App />
    </InvisibleAIProvider>
  </UseAIProvider>
);
