#!/bin/bash
# Records the multi-chat e2e walkthrough (test/multi-chat.e2e.test.ts) twice, as videos:
#   BEFORE  against the base the current branch started from (the code without its changes),
#   AFTER   against the current checkout.
# Both runs play the whole walkthrough and show each check on screen; the BEFORE run is expected
# to fail some of them.
#
# Usage: ENV_FILE=/path/to/env apps/example/scripts/record-multi-chat.sh [extra playwright args]
#   ENV_FILE  optional file exporting AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY (and any other server variables).
#             Without it, one of those keys must already be set.
#   MOCK=1    use the server's mock agent instead: no key, no paid calls.
#   BASE_REF  ref whose merge-base with HEAD is the BEFORE build (default: origin/main).
#   BASE_DIR  where the BEFORE build is extracted and kept between runs
#             (default: $TMPDIR/use-ai-base-<sha>). Built once, reused after.
#   AFTER_LABEL  caption of the AFTER video (default: "AFTER (<sha>)").
#   OUT_DIR   where the videos are copied (default: apps/example/videos).
#   BROWSER_EXECUTABLE  headless shell to record with. By default the one Playwright expects,
#             else the newest one already in the Playwright cache, else it is installed.
#
# Prints the video paths and the failed checks of each run at the end. Exits with the AFTER
# run's status.
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
if [ -n "${MOCK:-}" ]; then
  CONFIG="playwright.mock.config.ts"
  export MULTI_CHAT_MOCK_AGENT=1
  # Keeps apps/example/.env out of the Playwright process, whose environment reaches the servers.
  PLAYWRIGHT=(bunx --no-env-file playwright)
else
  CONFIG="playwright.config.ts"
  PLAYWRIGHT=(bunx playwright)
  [ -n "${AI_GATEWAY_API_KEY:-}" ] || [ -n "${ANTHROPIC_API_KEY:-}" ] \
    || fail "neither AI_GATEWAY_API_KEY nor ANTHROPIC_API_KEY is set (pass ENV_FILE=... or export one, or MOCK=1)"
fi
# The server rejects the example app's Socket.IO polling requests without a CORS origin.
export CORS_ORIGIN="${CORS_ORIGIN:-http://localhost:3000}"

check_ports() {
  # playwright.config.ts reuses servers already listening outside CI, which would test other code.
  for port in 3000 3002 8081; do
    if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
      fail "port $port is in use; stop that server first (bun run kill)"
    fi
  done
}
check_ports

cd "$EXAMPLE_DIR" || fail "cannot cd to $EXAMPLE_DIR"
if [ -z "${BROWSER_EXECUTABLE:-}" ]; then
  EXPECTED="$(bunx playwright install --dry-run chromium-headless-shell 2>/dev/null \
    | awk '/Install location:/ { print $3; exit }')"
  if [ -z "$EXPECTED" ] || ! ls "$EXPECTED"/*/chrome-headless-shell >/dev/null 2>&1; then
    CACHED="$(find "$(dirname "${EXPECTED:-$HOME/Library/Caches/ms-playwright/x}")" -maxdepth 3 \
      -path '*/chromium_headless_shell-*/*/chrome-headless-shell' 2>/dev/null | sort -V | tail -n 1)"
    if [ -n "$CACHED" ]; then
      echo "== Using cached headless shell: $CACHED"
      export BROWSER_EXECUTABLE="$CACHED"
    else
      echo "== Installing Playwright's headless shell"
      bunx playwright install chromium-headless-shell || fail "browser install failed (output above)"
    fi
  fi
fi

BASE_REF="${BASE_REF:-origin/main}"
BASE_SHA="$(git -C "$ROOT_DIR" merge-base HEAD "$BASE_REF")" || fail "no merge-base between HEAD and $BASE_REF"
BASE_SHORT="$(git -C "$ROOT_DIR" rev-parse --short "$BASE_SHA")"
# The last commit that changed the packages: the build the AFTER video shows.
AFTER_SHORT="$(git -C "$ROOT_DIR" log -1 --format=%h -- packages)"
BEFORE_LABEL="BEFORE (base $BASE_SHORT)"
AFTER_LABEL="${AFTER_LABEL:-AFTER ($AFTER_SHORT)}"
[ -n "$(git -C "$ROOT_DIR" diff --name-only "$BASE_SHA" HEAD -- packages)" ] \
  || fail "HEAD changes nothing under packages/ since $BASE_SHORT; BEFORE and AFTER would be the same build"

BASE_DIR="${BASE_DIR:-${TMPDIR:-/tmp}/use-ai-base-$BASE_SHA}"
BASE_DIR="${BASE_DIR%/}"
if [ ! -f "$BASE_DIR/.multi-chat-built" ]; then
  echo "== Building BEFORE ($BASE_SHORT) in $BASE_DIR"
  [ ! -e "$BASE_DIR" ] || [ -z "$(ls -A "$BASE_DIR")" ] \
    || fail "$BASE_DIR exists but holds no finished build; remove it or set BASE_DIR"
  mkdir -p "$BASE_DIR" || fail "cannot create $BASE_DIR"
  git -C "$ROOT_DIR" archive "$BASE_SHA" | tar -x -C "$BASE_DIR" || fail "could not extract $BASE_SHORT"
  (cd "$BASE_DIR" && bun install --frozen-lockfile && bun run build) || fail "BEFORE build failed (output above)"
  touch "$BASE_DIR/.multi-chat-built"
fi
# The base runs today's walkthrough and server config.
cp "$EXAMPLE_DIR/$SPEC" "$BASE_DIR/apps/example/$SPEC" || fail "could not copy the spec into $BASE_DIR"
cp "$EXAMPLE_DIR/$CONFIG" "$BASE_DIR/apps/example/$CONFIG" || fail "could not copy $CONFIG into $BASE_DIR"
if [ -n "${MOCK:-}" ]; then
  # Both runs answer with today's mock agent, so only the client differs between them.
  MOCK_MODEL="packages/server/src/agents/testing/MockReasoningModel.ts"
  cp "$ROOT_DIR/$MOCK_MODEL" "$BASE_DIR/$MOCK_MODEL" || fail "could not copy the mock agent into $BASE_DIR"
  (cd "$BASE_DIR/packages/server" && bun run build) || fail "BEFORE server build failed (output above)"
fi

echo "== Building AFTER ($AFTER_SHORT)"
(cd "$ROOT_DIR" && bun run build) || fail "AFTER build failed (output above)"

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

# run_walkthrough <before|after> <example dir> <caption>: sets RUN_STATUS and RUN_VIDEO.
run_walkthrough() {
  local name="$1" dir="$2" caption="$3"
  local results="$dir/test-results" marker
  check_ports
  marker="$(mktemp)"
  echo "== Recording $caption"
  (cd "$dir" && MULTI_CHAT_LABEL="$caption" MULTI_CHAT_CHECKS_FILE="$OUT_DIR/multi-chat-$STAMP-$name.json" \
    "${PLAYWRIGHT[@]}" test "$SPEC" -c "$CONFIG" --project=chromium --reporter=line --output="$results" "${@:4}")
  RUN_STATUS=$?
  local video
  video="$(find "$results" -name '*.webm' -newer "$marker" 2>/dev/null | head -n 1)"
  rm -f "$marker"
  [ -n "$video" ] || fail "no $name video was recorded (playwright exit $RUN_STATUS, output above)"
  RUN_VIDEO="$OUT_DIR/multi-chat-$STAMP-$name.webm"
  cp "$video" "$RUN_VIDEO"
}

print_checks() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "   walkthrough stopped before the end (no check results; see the playwright output above)"
    return
  fi
  bun -e '
    const results = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const failed = results.filter((r) => !r.passed);
    console.log(`   ${results.length - failed.length}/${results.length} checks passed`);
    for (const r of failed) console.log(`   FAIL: ${r.name}: ${r.error}`);
  ' "$file"
}

run_walkthrough before "$BASE_DIR/apps/example" "$BEFORE_LABEL" "$@"
BEFORE_VIDEO="$RUN_VIDEO"
run_walkthrough after "$EXAMPLE_DIR" "$AFTER_LABEL" "$@"
AFTER_VIDEO="$RUN_VIDEO"
AFTER_STATUS="$RUN_STATUS"

if command -v ffmpeg >/dev/null 2>&1; then
  for video in "$BEFORE_VIDEO" "$AFTER_VIDEO"; do
    ffmpeg -loglevel error -y -i "$video" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${video%.webm}.mp4" \
      || echo "WARNING: mp4 conversion failed for $video" >&2
  done
  COMBINED="$OUT_DIR/multi-chat-$STAMP-before-after.mp4"
  ffmpeg -loglevel error -y -i "${BEFORE_VIDEO%.webm}.mp4" -i "${AFTER_VIDEO%.webm}.mp4" \
    -filter_complex '[0:v][1:v]concat=n=2:v=1:a=0[v]' -map '[v]' -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$COMBINED" \
    || { echo "WARNING: could not join the videos" >&2; COMBINED=""; }
fi

echo
echo "$BEFORE_LABEL: $BEFORE_VIDEO"
print_checks "$OUT_DIR/multi-chat-$STAMP-before.json"
echo "$AFTER_LABEL: $AFTER_VIDEO"
print_checks "$OUT_DIR/multi-chat-$STAMP-after.json"
[ -z "${COMBINED:-}" ] || echo "BEFORE then AFTER: $COMBINED"
if [ "$AFTER_STATUS" -eq 0 ]; then
  echo "AFTER PASSED."
else
  echo "AFTER FAILED (playwright exit $AFTER_STATUS, errors above)." >&2
fi
exit "$AFTER_STATUS"
