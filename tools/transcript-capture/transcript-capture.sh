#!/bin/bash
# transcript-capture.sh — All-in-one: inject, poll loop, save to file
#
# Usage:
#   ./transcript-capture.sh                          # Default: poll every 5s, save to ./transcripts/
#   ./transcript-capture.sh --interval 3             # Poll every 3 seconds
#   ./transcript-capture.sh --output ~/tom-log.jsonl # Custom output file
#   ./transcript-capture.sh --no-inject              # Skip injection (already injected)
#
# Press Ctrl+C to stop. Final drain is performed on exit.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Defaults ─────────────────────────────────────────────────────────────────
INTERVAL=5
OUTPUT_DIR="$SCRIPT_DIR/transcripts"
OUTPUT_FILE=""
SKIP_INJECT=false
LAST_POLL_TS=0

# ── Parse Args ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval|-i) INTERVAL="$2"; shift 2 ;;
    --output|-o) OUTPUT_FILE="$2"; shift 2 ;;
    --no-inject) SKIP_INJECT=true; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── Setup Output ─────────────────────────────────────────────────────────────
if [ -z "$OUTPUT_FILE" ]; then
  mkdir -p "$OUTPUT_DIR"
  TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
  OUTPUT_FILE="$OUTPUT_DIR/tom_transcript_${TIMESTAMP}.jsonl"
fi

echo "Transcript output: $OUTPUT_FILE"

# ── Inject ───────────────────────────────────────────────────────────────────
if [ "$SKIP_INJECT" = false ]; then
  echo "Injecting capture payload..."
  RESULT=$("$SCRIPT_DIR/capture.sh" inject 2>&1)
  echo "  $RESULT"
fi

LAST_POLL_TS=$(osascript -e '
tell application "Google Chrome"
    tell active tab of front window
        execute javascript "Date.now()"
    end tell
end tell')

echo "Polling every ${INTERVAL}s. Press Ctrl+C to stop."
echo "---"

# ── Cleanup on exit ──────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "Final drain..."
  FINAL=$("$SCRIPT_DIR/poll.sh" --drain 2>/dev/null || echo "[]")
  if [ "$FINAL" != "[]" ] && [ "$FINAL" != "" ]; then
    echo "$FINAL" | python3 -c "
import sys, json
entries = json.load(sys.stdin)
for e in entries:
    print(json.dumps(e))
" >> "$OUTPUT_FILE" 2>/dev/null || true
  fi
  LINES=$(wc -l < "$OUTPUT_FILE" 2>/dev/null || echo "0")
  echo "Saved $LINES total entries to $OUTPUT_FILE"
  exit 0
}
trap cleanup SIGINT SIGTERM

# ── Poll Loop ────────────────────────────────────────────────────────────────
while true; do
  sleep "$INTERVAL"

  ENTRIES=$(osascript << APPLESCRIPT 2>/dev/null
tell application "Google Chrome"
    tell active tab of front window
        execute javascript "
            (function() {
                if (!window.__tomTranscript) return '[]';
                var items = window.__tomTranscript.since($LAST_POLL_TS);
                if (items.length === 0) return '[]';
                return JSON.stringify(items);
            })();
        "
    end tell
end tell
APPLESCRIPT
  )

  if [ -z "$ENTRIES" ] || [ "$ENTRIES" = "[]" ]; then
    continue
  fi

  # Update poll timestamp
  LAST_POLL_TS=$(osascript -e '
tell application "Google Chrome"
    tell active tab of front window
        execute javascript "Date.now()"
    end tell
end tell' 2>/dev/null || echo "$LAST_POLL_TS")

  # Append each entry as a JSONL line
  echo "$ENTRIES" | python3 -c "
import sys, json
try:
    entries = json.load(sys.stdin)
    for e in entries:
        line = json.dumps(e)
        print(line)
        sys.stdout.flush()
except:
    pass
" | tee -a "$OUTPUT_FILE"

done
