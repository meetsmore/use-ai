#!/bin/bash
# Records the multi-chat e2e walkthrough (test/multi-chat.e2e.test.ts) as a video.
#
# Usage: ENV_FILE=/path/to/env apps/example/scripts/record-multi-chat.sh [extra playwright args]
#   ENV_FILE  optional file exporting ANTHROPIC_API_KEY (and any other server variables).
#             Without it, ANTHROPIC_API_KEY must already be set.
#   OUT_DIR   where the video is copied (default: apps/example/videos).
#   BROWSER_EXECUTABLE  headless shell to record with. By default the one Playwright expects,
#             else the newest one already in the Playwright cache, else it is installed.
#
# Builds the packages, starts the example servers through playwright.config.ts, runs only the
# multi-chat spec with video on, and prints the video path at the end.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLE_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$EXAMPLE_DIR")")"
OUT_DIR="${OUT_DIR:-$EXAMPLE_DIR/videos}"
SPEC="test/multi-chat.e2e.test.ts"

fail() { echo "ERROR: $1" >&2; exit 1; }

if [ -n "${ENV_FILE:-}" ]; then
  [ -f "$ENV_FILE" ] || fail "ENV_FILE not found: $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE" || fail "could not load ENV_FILE: $ENV_FILE"
  set +a
fi
[ -n "${ANTHROPIC_API_KEY:-}" ] || fail "ANTHROPIC_API_KEY is not set (pass ENV_FILE=... or export it)"
# The server rejects the example app's Socket.IO polling requests without a CORS origin.
export CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:3000}"

# playwright.config.ts reuses servers already listening outside CI, which would test other code.
for port in 3000 3002 8081; do
  if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "port $port is in use; stop that server first (bun run kill)"
  fi
done

cd "$EXAMPLE_DIR" || fail "cannot cd to $EXAMPLE_DIR"
if [ -z "${BROWSER_EXECUTABLE:-}" ]; then
  EXPECTED="$(bunx playwright install --dry-run chromium-headless-shell 2>/dev/null \
    | awk '/Install location:/ { print $3; exit }')"
  if [ -z "$EXPECTED" ] || ! ls "$EXPECTED"/*/chrome-headless-shell >/dev/null 2>&1; then
    CACHED="$(ls -d "$(dirname "${EXPECTED:-$HOME/Library/Caches/ms-playwright/x}")"/chromium_headless_shell-*/*/chrome-headless-shell 2>/dev/null | sort -V | tail -n 1)"
    if [ -n "$CACHED" ]; then
      echo "== Using cached headless shell: $CACHED"
      export BROWSER_EXECUTABLE="$CACHED"
    else
      echo "== Installing Playwright's headless shell"
      bunx playwright install chromium-headless-shell || fail "browser install failed (output above)"
    fi
  fi
fi

echo "== Building packages"
(cd "$ROOT_DIR" && bun run build) || fail "build failed (output above)"

RESULTS_DIR="$EXAMPLE_DIR/test-results"
MARKER="$(mktemp)"

echo "== Running $SPEC"
bunx playwright test "$SPEC" --project=chromium --reporter=line --output="$RESULTS_DIR" "$@"
STATUS=$?

VIDEO="$(find "$RESULTS_DIR" -name '*.webm' -newer "$MARKER" 2>/dev/null | head -n 1)"
rm -f "$MARKER"
if [ -z "$VIDEO" ]; then
  fail "no video was recorded (playwright exit $STATUS, output above)"
fi

mkdir -p "$OUT_DIR"
DEST="$OUT_DIR/multi-chat-$(date +%Y%m%d-%H%M%S).webm"
cp "$VIDEO" "$DEST"
if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -loglevel error -y -i "$DEST" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${DEST%.webm}.mp4" \
    && echo "MP4: ${DEST%.webm}.mp4"
fi

if [ "$STATUS" -eq 0 ]; then
  echo "PASSED. Video: $DEST"
else
  echo "FAILED (playwright exit $STATUS, errors above). Video: $DEST" >&2
fi
exit "$STATUS"
