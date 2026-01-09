#!/bin/bash
# Build the use-ai-server Docker image with version from package.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Extract version from packages/core/package.json (source of truth for monorepo version)
VERSION=$(node -p "require('$REPO_ROOT/packages/core/package.json').version")

IMAGE="ghcr.io/meetsmore/use-ai-server"

echo "Building $IMAGE:$VERSION"

docker build \
  -f "$SCRIPT_DIR/Dockerfile" \
  --build-arg VERSION="$VERSION" \
  -t "$IMAGE:$VERSION" \
  -t "$IMAGE:latest" \
  "$REPO_ROOT" \
  "$@"

echo "Built: $IMAGE:$VERSION, $IMAGE:latest"
