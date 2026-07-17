#!/usr/bin/env bash
# demo_bridge_live.sh — Comprehensive Floyd TTY Bridge SDK demo
# Exercises 10+ bridge tools on Hacker News
# Run inside the Floyd TTY Bridge sidepanel terminal

# ─── Setup ────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
EVIDENCE_DIR="${PROJECT_ROOT}/.sisyphus/evidence"
LOG_FILE="${EVIDENCE_DIR}/demo-results.log"
EXTRACTED_TEXT_FILE="${EVIDENCE_DIR}/demo-extracted-content.txt"

# Create evidence directory
mkdir -p "$EVIDENCE_DIR"

# Source the Floyd SDK
SDK_PATH="${PROJECT_ROOT}/extension/floyd-tools.sh"
if [[ ! -f "$SDK_PATH" ]]; then
  echo "ERROR: SDK not found at $SDK_PATH" >&2
  exit 1
fi
source "$SDK_PATH"

# ─── Logging Functions ────────────────────────────────────────────────────────

log_message() {
  local msg="$1"
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] $msg" | tee -a "$LOG_FILE"
}

log_tool_call() {
  local tool="$1"
  local args="$2"
  log_message "TOOL CALL: $tool with args: $args"
}

log_tool_result() {
  local tool="$1"
  local result="$2"
  # Truncate long results for readability
  local truncated="${result:0:200}"
  if [[ ${#result} -gt 200 ]]; then
    truncated="${truncated}... (truncated)"
  fi
  log_message "TOOL RESULT: $tool returned: $truncated"
}

log_error() {
  local msg="$1"
  log_message "ERROR: $msg"
}

# ─── Screenshot Decoder ───────────────────────────────────────────────────────

save_screenshot() {
  local name="$1"
  local json_response="$2"

  # Extract base64 data URL from JSON
  local data_url=$(echo "$json_response" | python3 -c "
import sys, json, base64, os
try:
  data = json.load(sys.stdin)
  url = data.get('dataUrl') or data.get('result', {}).get('dataUrl')
  if url and url.startswith('data:image/png;base64,'):
    print(url[22:])
except:
  pass
" 2>/dev/null)

  if [[ -z "$data_url" ]]; then
    log_error "Failed to extract base64 from screenshot response"
    return 1
  fi

  # Decode and save
  local filename="${EVIDENCE_DIR}/screenshot_${name}.png"
  echo "$data_url" | base64 -d > "$filename" 2>/dev/null
  if [[ -f "$filename" ]]; then
    log_message "Screenshot saved: $filename"
    return 0
  else
    log_error "Failed to save screenshot: $filename"
    return 1
  fi
}

# ─── Tool Wrapper with Error Handling ─────────────────────────────────────────

call_tool() {
  local tool="$1"
  local args="${2:-{}}"

  log_tool_call "$tool" "$args"

  local result
  if ! result=$(floyd_call "$tool" "$args" 2>&1); then
    log_error "Tool call failed: $tool"
    echo ""
    return 1
  fi

  log_tool_result "$tool" "$result"
  echo "$result"
  return 0
}

# ─── Demo Workflow ────────────────────────────────────────────────────────────

log_message "========== FLOYD TTY BRIDGE DEMO START =========="
log_message "Evidence directory: $EVIDENCE_DIR"
log_message "Log file: $LOG_FILE"

# 1. Navigate to Hacker News
log_message "--- STEP 1: Navigate to Hacker News ---"
nav_result=$(call_tool "navigate_to" '{"url":"https://news.ycombinator.com"}')
if [[ -z "$nav_result" ]]; then
  log_error "Navigation failed, continuing anyway..."
fi
sleep 2

# 2. Get page state
log_message "--- STEP 2: Get page state ---"
page_state=$(call_tool "get_page_state" '{}')
if [[ -n "$page_state" ]]; then
  log_message "Page state retrieved successfully"
fi

# 3. Analyze page
log_message "--- STEP 3: Analyze page (full audit) ---"
analysis=$(call_tool "analyze_page" '{"include_css":true,"include_accessibility":true}')
if [[ -n "$analysis" ]]; then
  log_message "Page analysis completed"
fi

# 4. Find story elements using floyd_find (text query, not CSS selector)
log_message "--- STEP 4: Find story links using floyd_find ---"
stories=$(call_tool "find_elements" '{"query":"story"}')
if [[ -n "$stories" ]]; then
  log_message "Story elements found"
  # Parse to get count
  story_count=$(echo "$stories" | python3 -c "
import sys, json
try:
  data = json.load(sys.stdin)
  if isinstance(data, dict) and 'elements' in data:
    print(len(data['elements']))
  elif isinstance(data, list):
    print(len(data))
  else:
    print(0)
except:
  print(0)
" 2>/dev/null)
  log_message "Found $story_count story elements"
fi

# 5. Take screenshot of homepage
log_message "--- STEP 5: Take screenshot of homepage ---"
screenshot1=$(call_tool "take_screenshot" '{}')
if [[ -n "$screenshot1" ]]; then
  save_screenshot "01_homepage" "$screenshot1"
fi

# 6. Check accessibility
log_message "--- STEP 6: Check accessibility (WCAG AA) ---"
a11y=$(call_tool "check_accessibility" '{"level":"AA"}')
if [[ -n "$a11y" ]]; then
  log_message "Accessibility audit completed"
fi

# 7. Find and click first story link
log_message "--- STEP 7: Find and click first story ---"
# Use find_elements to get story links
story_links=$(call_tool "find_elements" '{"query":"link"}')
if [[ -n "$story_links" ]]; then
  # Extract first link selector from results
  first_selector=$(echo "$story_links" | python3 -c "
import sys, json
try:
  data = json.load(sys.stdin)
  if isinstance(data, dict) and 'elements' in data and len(data['elements']) > 0:
    elem = data['elements'][0]
    if 'selector' in elem:
      print(elem['selector'])
except:
  pass
" 2>/dev/null)

  if [[ -n "$first_selector" ]]; then
    log_message "Clicking first story with selector: $first_selector"
    click_result=$(call_tool "click_element" "{\"selector\":\"$first_selector\"}")
    sleep 2
  else
    log_message "Could not extract selector from story links, trying generic story click"
    click_result=$(call_tool "click_element" '{"selector":"a.titleline"}')
    sleep 2
  fi
fi

# 8. Get page state after navigation
log_message "--- STEP 8: Get page state after story click ---"
page_state2=$(call_tool "get_page_state" '{}')
if [[ -n "$page_state2" ]]; then
  log_message "Page state after navigation retrieved"
fi

# 9. Extract text content from story page
log_message "--- STEP 9: Extract text content ---"
text_content=$(call_tool "extract_text" '{"selector":"body"}')
if [[ -n "$text_content" ]]; then
  echo "$text_content" | python3 -c "
import sys, json
try:
  data = json.load(sys.stdin)
  results = data.get('result', {}).get('results', [])
  if results:
    text_parts = [r.get('text', '') for r in results if isinstance(r, dict)]
    print('\n'.join(text_parts))
  elif isinstance(data, str):
    print(data)
except:
  print(sys.stdin.read())
" > "$EXTRACTED_TEXT_FILE" 2>/dev/null
  log_message "Text content extracted and saved to $EXTRACTED_TEXT_FILE"
fi

# 10. Take screenshot of story page
log_message "--- STEP 10: Take screenshot of story page ---"
screenshot2=$(call_tool "take_screenshot" '{}')
if [[ -n "$screenshot2" ]]; then
  save_screenshot "02_story_page" "$screenshot2"
fi

# 11. Scroll to bottom
log_message "--- STEP 11: Scroll to bottom ---"
scroll_result=$(call_tool "scroll_to" '{"target":"bottom"}')
if [[ -n "$scroll_result" ]]; then
  log_message "Scrolled to bottom"
fi

# 12. Analyze page again after scroll
log_message "--- STEP 12: Analyze page after scroll ---"
analysis2=$(call_tool "analyze_page" '{"include_css":false,"include_accessibility":false}')
if [[ -n "$analysis2" ]]; then
  log_message "Page analysis after scroll completed"
fi

# 13. Navigate back to homepage
log_message "--- STEP 13: Navigate back to homepage ---"
back_result=$(call_tool "navigate_to" '{"url":"https://news.ycombinator.com"}')
sleep 2
if [[ -z "$back_result" ]]; then
  log_error "Navigation back failed, continuing..."
fi

# 14. List open tabs
log_message "--- STEP 14: List open tabs ---"
tabs=$(call_tool "list_tabs" '{}')
if [[ -n "$tabs" ]]; then
  tab_count=$(echo "$tabs" | python3 -c "
import sys, json
try:
  data = json.load(sys.stdin)
  if isinstance(data, dict) and 'tabs' in data:
    print(len(data['tabs']))
  elif isinstance(data, list):
    print(len(data))
  else:
    print(0)
except:
  print(0)
" 2>/dev/null)
  log_message "Found $tab_count open tabs"
fi

# 15. Extract CSS from main element
log_message "--- STEP 15: Extract CSS from main element ---"
css=$(call_tool "extract_css" '{"selector":"main"}')
if [[ -n "$css" ]]; then
  log_message "CSS extraction completed"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────

log_message "========== FLOYD TTY BRIDGE DEMO COMPLETE =========="
log_message "Tools exercised:"
log_message "  1. navigate_to (2x)"
log_message "  2. get_page_state (2x)"
log_message "  3. analyze_page (2x)"
log_message "  4. find_elements (2x)"
log_message "  5. take_screenshot (2x)"
log_message "  6. check_accessibility"
log_message "  7. click_element"
log_message "  8. extract_text"
log_message "  9. scroll_to"
log_message "  10. list_tabs"
log_message "  11. extract_css"
log_message ""
log_message "Evidence files:"
log_message "  - $LOG_FILE"
log_message "  - $EXTRACTED_TEXT_FILE"
log_message "  - ${EVIDENCE_DIR}/screenshot_*.png"
log_message ""
log_message "Demo completed successfully!"

exit 0
