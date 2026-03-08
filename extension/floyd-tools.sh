#!/usr/bin/env bash
# floyd-tools.sh — Agent SDK for Floyd's Labs TTY Bridge v4.0
#
# Source this file in any shell session running inside the Floyd TTY Bridge
# to get access to browser control functions via OSC 7701/7702 escape sequences.
#
# Usage:
#   source floyd-tools.sh
#   floyd_analyze_page
#   floyd_click ".btn-submit"
#   floyd_query "How do I file a tax extension?"
#   result=$(floyd_call extract_text '{"selector":"main"}')

# ─── Guard: only works inside Floyd TTY Bridge ────────────────────────────────

if [[ "$FLOYD_TTY_BRIDGE" != "4.0" ]] && [[ "$FLOYD_TOOLS_AVAILABLE" != "1" ]]; then
  echo "[floyd-tools] WARNING: Not running inside Floyd TTY Bridge. Commands will not work." >&2
fi

# ─── Core: send OSC 7701, receive OSC 7702 ───────────────────────────────────

_floyd_request_id=0

floyd_call() {
  # Send a tool call and capture the response
  # Usage: floyd_call <tool_name> [json_args]
  # Returns: JSON response on stdout
  local tool="$1"
  local args="${2:-{}}"
  _floyd_request_id=$((_floyd_request_id + 1))
  local id="sh_${_floyd_request_id}_$$"

  # Send OSC 7701 command
  printf '\033]7701;{"id":"%s","tool":"%s","args":%s}\007' "$id" "$tool" "$args"

  # Read the OSC 7702 response
  # The bridge writes back: \033]7702;{json}\007
  local response=""
  local char=""
  local in_osc=0
  local osc_body=""

  # Read character by character until we get our response
  # Works in both bash and zsh
  while true; do
    if [ -n "$ZSH_VERSION" ]; then
      if ! read -r -k 1 -t 30 char; then break; fi
    else
      if ! IFS= read -r -n 1 -t 30 char; then break; fi
    fi

    if [[ $in_osc -eq 1 ]]; then
      if [[ "$char" == $'\007' ]]; then
        # End of OSC sequence
        if [[ "$osc_body" == 7702\;* ]]; then
          response="${osc_body#7702;}"
          break
        fi
        in_osc=0
        osc_body=""
      else
        osc_body="${osc_body}${char}"
      fi
    elif [[ "$char" == $'\033' ]]; then
      # Potential start of OSC
      if [ -n "$ZSH_VERSION" ]; then
        read -r -k 1 -t 5 char
      else
        IFS= read -r -n 1 -t 5 char
      fi
      if [[ "$char" == "]" ]]; then
        in_osc=1
        osc_body=""
      fi
    fi
  done

  if [[ -z "$response" ]]; then
    echo '{"ok":false,"error":"timeout"}'
    return 1
  fi

  # Check if response points to a file (large payload)
  if echo "$response" | grep -q '"file":'; then
    local filepath
    filepath=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('file',''))" 2>/dev/null)
    if [[ -n "$filepath" && -f "$filepath" ]]; then
      cat "$filepath"
      return 0
    fi
  fi

  echo "$response"
}

# ─── Convenience Functions ────────────────────────────────────────────────────

floyd_analyze_page() {
  floyd_call analyze_page '{"include_css":true,"include_accessibility":true}'
}

floyd_dom() {
  floyd_call analyze_page '{"include_css":false,"include_accessibility":false}'
}

floyd_a11y() {
  local level="${1:-AA}"
  floyd_call check_accessibility "{\"level\":\"$level\"}"
}

floyd_click() {
  local selector="$1"
  floyd_call click_element "{\"selector\":\"$selector\"}"
}

floyd_type() {
  local selector="$1"
  local text="$2"
  floyd_call type_text "{\"selector\":\"$selector\",\"text\":\"$text\"}"
}

floyd_navigate() {
  local url="$1"
  floyd_call navigate_to "{\"url\":\"$url\"}"
}

floyd_screenshot() {
  floyd_call take_screenshot '{}'
}

floyd_find() {
  local selector="$1"
  floyd_call find_elements "{\"selector\":\"$selector\"}"
}

floyd_extract_text() {
  local selector="${1:-body}"
  floyd_call extract_text "{\"selector\":\"$selector\"}"
}

floyd_extract_css() {
  local selector="$1"
  floyd_call extract_css "{\"selector\":\"$selector\"}"
}

floyd_contrast() {
  local selector="${1:-body}"
  floyd_call check_contrast "{\"selector\":\"$selector\"}"
}

floyd_fill_form() {
  # Usage: floyd_fill_form '{"#name":"John","#email":"john@example.com"}'
  local fields="$1"
  floyd_call fill_form "{\"fields\":$fields}"
}

floyd_select() {
  local selector="$1"
  local value="$2"
  floyd_call select_option "{\"selector\":\"$selector\",\"value\":\"$value\"}"
}

floyd_scroll() {
  local target="${1:-bottom}"
  floyd_call scroll_to "{\"target\":\"$target\"}"
}

floyd_wait() {
  local selector="$1"
  local timeout="${2:-5000}"
  floyd_call wait_for_element "{\"selector\":\"$selector\",\"timeout\":$timeout}"
}

floyd_tabs() {
  floyd_call list_tabs '{}'
}

floyd_open_tab() {
  local url="$1"
  floyd_call open_tab "{\"url\":\"$url\"}"
}

floyd_close_tab() {
  local tab_id="$1"
  floyd_call close_tab "{\"tab_id\":$tab_id}"
}

floyd_switch_tab() {
  local tab_id="$1"
  floyd_call switch_tab "{\"tab_id\":$tab_id}"
}

floyd_page_state() {
  floyd_call get_page_state '{}'
}

floyd_element() {
  local selector="$1"
  floyd_call analyze_element "{\"selector\":\"$selector\"}"
}

# ─── Knowledge Base Query ─────────────────────────────────────────────────────

floyd_query() {
  # Query the 12,419-document vectorized knowledge base
  # Usage: floyd_query "How do I file a tax extension?" [collection] [top_k]
  local query="$1"
  local collection="${2:-}"
  local top_k="${3:-5}"

  local args="{\"query\":\"$query\",\"top_k\":$top_k"
  if [[ -n "$collection" ]]; then
    args="${args},\"collection\":\"$collection\""
  fi
  args="${args}}"

  floyd_call query_knowledge "$args"
}

# ─── Status ───────────────────────────────────────────────────────────────────

floyd_status() {
  echo "Floyd's Labs TTY Bridge v4.0 — Agent SDK"
  echo "  Bridge: ${FLOYD_TTY_BRIDGE:-not detected}"
  echo "  Tools:  ${FLOYD_TOOLS_AVAILABLE:-not available}"
  echo "  Shell:  $SHELL (PID $$)"
  echo ""
  echo "Available commands:"
  echo "  floyd_call <tool> [json_args]  — Raw tool call"
  echo "  floyd_analyze_page             — Full page analysis"
  echo "  floyd_dom                      — DOM structure"
  echo "  floyd_a11y [AA|AAA]            — Accessibility audit"
  echo "  floyd_click <selector>         — Click element"
  echo "  floyd_type <selector> <text>   — Type into element"
  echo "  floyd_navigate <url>           — Navigate to URL"
  echo "  floyd_screenshot               — Capture visible tab"
  echo "  floyd_find <selector>          — Find elements"
  echo "  floyd_extract_text [selector]  — Extract text content"
  echo "  floyd_extract_css <selector>   — Get computed CSS"
  echo "  floyd_contrast [selector]      — Check contrast ratios"
  echo "  floyd_fill_form '{fields}'     — Fill multiple form fields"
  echo "  floyd_select <sel> <value>     — Select dropdown option"
  echo "  floyd_scroll [target]          — Scroll to position"
  echo "  floyd_wait <selector> [ms]     — Wait for element"
  echo "  floyd_tabs                     — List open tabs"
  echo "  floyd_open_tab <url>           — Open new tab"
  echo "  floyd_close_tab <id>           — Close tab"
  echo "  floyd_switch_tab <id>          — Switch to tab"
  echo "  floyd_page_state               — Current page state"
  echo "  floyd_element <selector>       — Deep element analysis"
  echo "  floyd_query <text> [coll] [k]  — Query knowledge base"
  echo "  floyd_status                   — This help"
}

# Announce availability
if [[ "$FLOYD_TTY_BRIDGE" == "4.0" ]]; then
  echo "[floyd-tools] 24 browser tools + knowledge base ready. Run floyd_status for help."
fi
