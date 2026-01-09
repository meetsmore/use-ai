# Contributing to use-ai

Thank you for your interest in contributing to use-ai! This document provides guidelines and instructions for contributing.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) (latest version)
- Node.js 18+ (for some tooling)
- An Anthropic API key (for running E2E tests)

### Getting Started

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/use-ai.git
   cd use-ai
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

4. Build all packages:
   ```bash
   bun run build
   ```

5. Run the development server:
   ```bash
   bun run dev
   ```

   This starts the example app at http://localhost:3000 and the server at http://localhost:8081.

## Project Structure

```
├── apps/
│   ├── example/                 # Example todo app
│   ├── example-nest-mcp-server/ # NestJS MCP server example
│   └── use-ai-server-app/       # Standalone server
├── packages/
│   ├── client/                  # React hooks and components
│   ├── core/                    # Shared types (AG-UI protocol)
│   ├── server/                  # Socket.IO server
│   ├── plugin-workflows/        # Workflow execution plugin
│   ├── plugin-workflows-client/ # Client hooks for workflows
│   └── plugin-mastra/           # Mastra integration plugin
```

## Development Workflow

### Running Tests

```bash
# Run all unit tests
bun run test

# Run tests for a specific package
bun run test packages/server/src/server.test.ts

# Run E2E tests (requires ANTHROPIC_API_KEY)
bun run test:e2e

# Run E2E tests with UI
bun run test:e2e:ui
```

### Building

```bash
# Build all packages
bun run build

# Build specific packages
bun run build:client
bun run build:server
```

### Code Style

- Use TypeScript for all code
- Never use `any` type unless absolutely unavoidable
- Follow existing patterns in the codebase
- Keep changes focused and minimal

## Making Changes

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring

### Commit Messages

Write clear, concise commit messages that explain the "why" rather than the "what":

```
Add rate limiting per user session

Previously rate limiting was only per IP, which didn't work well
for shared networks. This adds session-based rate limiting as an option.
```

### Pull Requests

1. Create a feature branch from `main`
2. Make your changes
3. Ensure all tests pass: `bun run test`
4. Ensure the build succeeds: `bun run build`
5. Submit a pull request

In your PR description:
- Describe what the change does
- Explain why the change is needed
- Include any relevant issue numbers
- Add a test plan if applicable

## Adding New Features

### Adding a New Tool

1. Define the tool with `defineTool()` in your component
2. Add to the `useAI` hook's `tools` object
3. Update component state in `prompt` argument
4. Write unit tests
5. Consider adding E2E tests for complex features

### Adding a New Plugin

1. Create a new package in `packages/`
2. Implement the `UseAIServerPlugin` interface
3. Add tests
4. Document usage in README

## Reporting Issues

- Use the issue templates when available
- Include reproduction steps
- Include relevant environment info (OS, Bun version, etc.)
- For security issues, see [SECURITY.md](SECURITY.md)

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Questions?

Feel free to open an issue for questions or discussions about contributing.
