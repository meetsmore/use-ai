#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$EXAMPLE_DIR")")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[React 16 Test]${NC} $1"; }
warn() { echo -e "${YELLOW}[React 16 Test]${NC} $1"; }
error() { echo -e "${RED}[React 16 Test]${NC} $1"; }

cleanup() {
    log "Cleaning up - restoring React 18..."
    cd "$EXAMPLE_DIR"
    bun remove react react-dom @types/react @types/react-dom 2>/dev/null || true
    bun add react@^18.2.0 react-dom@^18.2.0
    bun add -d @types/react@^18 @types/react-dom@^18

    # Rebuild client package with React 18
    cd "$ROOT_DIR/packages/client"
    bun run build

    log "React 18 restored"
}

# Set trap to cleanup on exit (success or failure)
trap cleanup EXIT

log "Starting React 16 e2e tests..."

# Step 1: Install React 16 in example app
log "Installing React 16..."
cd "$EXAMPLE_DIR"
bun remove react react-dom @types/react @types/react-dom 2>/dev/null || true
bun add react@^16.14.0 react-dom@^16.14.0
bun add -d @types/react@^16.14.0 @types/react-dom@^16.9.0

# Step 2: Rebuild client package to pick up React 16
log "Rebuilding client package..."
cd "$ROOT_DIR/packages/client"
bun run build

# Step 3: Run e2e tests with React 16 config
log "Running e2e tests with React 16..."
cd "$EXAMPLE_DIR"

# Pass through any additional arguments (like --headed, --debug, specific test files)
if [ $# -eq 0 ]; then
    bunx playwright test --config=playwright.react16.config.ts
else
    bunx playwright test --config=playwright.react16.config.ts "$@"
fi

log "React 16 e2e tests completed successfully!"
