import { defineConfig, devices } from '@playwright/test';

// Ensure ANTHROPIC_API_KEY is set before running tests
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    'ANTHROPIC_API_KEY environment variable is required to run E2E tests.\n' +
    'Set it with: export ANTHROPIC_API_KEY=your_key_here'
  );
}

export default defineConfig({
  testDir: './test',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['dot'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'cd ../../apps/example-nest-mcp-server && LOG_SILENT=true MCP_PORT=3002 bun start',
      url: 'http://localhost:3002/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'cd ../../apps/use-ai-server-app && bun run start',
      url: 'http://localhost:8081/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
        MCP_ENDPOINT_LOCALDEV_URL: 'http://localhost:3002/mcp',
        MCP_ENDPOINT_LOCALDEV_NAMESPACE: 'mcp',
        LOG_SILENT: 'true',
      },
    },
    {
      // Use React 16 server instead of default server
      command: 'LOG_SILENT=true bun server.react16.ts',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
