import { defineConfig, devices } from '@playwright/test';

/**
 * Runs e2e tests against the server's mock agent: no provider key, no paid calls.
 * Every provider key is blanked and no .env file is loaded, so a key in a local .env cannot
 * reach the server. Only for tests that do not depend on what the model answers.
 */
export default defineConfig({
  testDir: './test',
  fullyParallel: false,
  workers: 1,
  reporter: [['dot']],
  use: { baseURL: 'http://localhost:3000' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'cd ../../apps/use-ai-server-app && bun --no-env-file src/index.ts',
      url: 'http://localhost:8081/health',
      reuseExistingServer: false,
      timeout: 30000,
      env: {
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
        AI_GATEWAY_API_KEY: '',
        USE_AI_ENABLE_MOCK_AGENT: 'true',
        CORS_ORIGIN: 'http://localhost:3000',
        LOG_SILENT: 'true',
      },
    },
    {
      command: 'LOG_SILENT=true bun --no-env-file run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
