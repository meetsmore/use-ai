import React from 'react';
import { createRoot } from 'react-dom/client';
import { UseAIProvider } from '@meetsmore-oss/use-ai-client';
import App from './App';
import { InvisibleAIProvider } from './providers/InvisibleAIProvider';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

const root = createRoot(container);
root.render(
  <UseAIProvider
    serverUrl="ws://localhost:8081"
    systemPrompt="You are a helpful AI assistant for a demo application. Be concise and friendly in your responses."
    enabledFeatures={{ inputDisclaimer: true }}
    forwardedPropsProvider={() => ({
      mcpHeaders: {
        'http://localhost:3002': {
          headers: { 'X-API-Key': 'secret-api-key-123' },
        },
      },
      telemetryMetadata: {
        userId: 'dummy',
        tenantId: 'example-tenant',
      },
      // Read token from global state (set by BeforeRunAgentPage demo toggle)
      ...(window.__useAiDemoToken ? { token: window.__useAiDemoToken } : {}),
    })}
  >
    <InvisibleAIProvider>
      <App />
    </InvisibleAIProvider>
  </UseAIProvider>
);
