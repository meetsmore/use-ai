# E2E Tests

This directory contains end-to-end tests for the use-ai example application using Playwright.

## Setup

1. Install dependencies (if not already installed):
```bash
bun install  # From repo root
bunx playwright install chromium
```

2. **REQUIRED**: Set the `ANTHROPIC_API_KEY` environment variable:
```bash
export ANTHROPIC_API_KEY=your_api_key_here
```

**Note**: Tests will be skipped if `ANTHROPIC_API_KEY` is not set. The server requires this to start.

## Running Tests

From the **root** of the repository:

```bash
# Run all E2E tests (headless)
bun run test:e2e

# Run with UI mode (interactive)
bun run test:e2e:ui

# Run with headed browser (see what's happening)
bun run test:e2e:headed

# Run in debug mode (step through tests)
bun run test:e2e:debug
```

## Test Files

### `edge-cases.e2e.test.ts`

Tests edge cases and bug reproductions, including:

1. **Hanging behavior reproduction**: Tests the scenario where:
   - AI adds a todo item
   - User manually deletes the todo item
   - AI tries to delete the already-deleted item
   - Previously this would cause the tool call to hang indefinitely
   - Test verifies that the AI responds properly instead of hanging

2. **Non-existent todo deletion**: Tests that the AI properly handles requests to delete todos that don't exist

3. **Multiple operations**: Tests complex sequences of add/delete operations

## How the Tests Work

1. The Playwright config starts both the server and the dev server automatically
2. Tests navigate to the todo list page
3. Tests interact with the AI chat panel to send prompts
4. Tests verify that the AI responds within a reasonable timeout (30 seconds)
5. If the AI doesn't respond within the timeout, the test fails, indicating a hanging issue

## Important Notes

- Tests require a real `ANTHROPIC_API_KEY` and will make actual API calls to Claude
- Tests will skip if `ANTHROPIC_API_KEY` is not set
- The server and client are started automatically by Playwright
- Tests run serially (`workers: 1`) to avoid race conditions with shared state
