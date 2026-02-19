#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/meetsmore/use-ai.git"
WORK_DIR=$(mktemp -d)

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

# Check prerequisites
for cmd in git bun npx; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: $cmd is not installed." >&2
    exit 1
  fi
done

VERSION="${USE_AI_VERSION:-}"
if [ -n "$VERSION" ]; then
  REF="v$VERSION"
else
  REF="${USE_AI_BRANCH:-main}"
fi

echo "Cloning use-ai (ref: $REF)..."
git clone --depth 1 --branch "$REF" "$REPO_URL" "$WORK_DIR/use-ai"

echo "Installing dependencies..."
cd "$WORK_DIR/use-ai"
bun install --frozen-lockfile

echo "Building packages..."
bun run build

echo "Building skill docs..."
bun run skill

echo ""
echo "Where do you want to install the skill?"
echo "  1) Project (current directory)"
echo "  2) Global (~/.claude/skills/)"
read -rp "Choose [1/2] (default: 1): " choice

GLOBAL_FLAG=""
if [ "$choice" = "2" ]; then
  GLOBAL_FLAG="-g"
fi

echo "Installing skill..."
npx skills add $GLOBAL_FLAG "$WORK_DIR/use-ai"

echo "Done."
