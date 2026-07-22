#!/bin/bash
# poll.sh — Retrieve transcript data from Tom the Peep
#
# Usage:
#   ./poll.sh                    # Dump all entries as JSON
#   ./poll.sh --text             # Human-readable text format
#   ./poll.sh --since 1710000000 # Entries since unix timestamp (ms)
#   ./poll.sh --drain            # Return all entries and clear buffer
#   ./poll.sh --count            # Just the entry count
#   ./poll.sh --clear            # Clear the buffer (no output)
#   ./poll.sh --last N           # Last N entries as JSON

set -euo pipefail

run_js() {
  osascript << APPLESCRIPT
tell application "Google Chrome"
    tell active tab of front window
        execute javascript "$1"
    end tell
end tell
APPLESCRIPT
}

case "${1:---dump}" in
  --text|-t)
    run_js "window.__tomTranscript ? window.__tomTranscript.text() : 'Capture not active'"
    ;;

  --since|-s)
    TS="${2:?Usage: poll.sh --since TIMESTAMP_MS}"
    run_js "window.__tomTranscript ? JSON.stringify(window.__tomTranscript.since($TS)) : '[]'"
    ;;

  --drain|-d)
    run_js "window.__tomTranscript ? JSON.stringify(window.__tomTranscript.drain()) : '[]'"
    ;;

  --count|-c)
    run_js "window.__tomTranscript ? window.__tomTranscript.count() : 0"
    ;;

  --clear)
    run_js "window.__tomTranscript ? (window.__tomTranscript.clear(), 'Cleared') : 'Not active'"
    ;;

  --last|-l)
    N="${2:-10}"
    run_js "window.__tomTranscript ? JSON.stringify(window.__tomTranscript.entries.slice(-$N)) : '[]'"
    ;;

  --dump|--json|-j|"")
    run_js "window.__tomTranscript ? window.__tomTranscript.dump() : '[]'"
    ;;

  *)
    echo "Usage: poll.sh [--text|--since TS|--drain|--count|--clear|--last N|--dump]"
    exit 1
    ;;
esac
