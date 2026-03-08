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

if [[ -z "$FLOYD_TTY_BRIDGE" ]] && [[ "$FLOYD_TOOLS_AVAILABLE" != "1" ]]; then
  echo "[floyd-tools] WARNING: Not running inside Floyd TTY Bridge. Commands will not work." >&2
fi

# ─── Core: send OSC 7701, receive OSC 7702 ───────────────────────────────────

_floyd_request_id=0

_floyd_json_escape() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  value=${value//$'\t'/\\t}
  printf '%s' "$value"
}

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
  local saw_esc=0
  local osc_saw_esc=0

  # Read character by character until we get our response
  # Works in both bash and zsh
  while true; do
    if [ -n "$ZSH_VERSION" ]; then
      if ! read -r -k 1 -t 30 char; then break; fi
    else
      if ! IFS= read -r -n 1 -t 30 char; then break; fi
    fi

    if [[ $in_osc -eq 1 ]]; then
      if [[ $osc_saw_esc -eq 1 ]]; then
        if [[ "$char" == '\\' ]]; then
          if [[ "$osc_body" == 7702\;* ]]; then
            response="${osc_body#7702;}"
            break
          fi
          in_osc=0
          osc_body=""
        else
          osc_body+=$'\033'
          osc_body+="$char"
        fi
        osc_saw_esc=0
      elif [[ "$char" == $'\007' ]]; then
        if [[ "$osc_body" == 7702\;* ]]; then
          response="${osc_body#7702;}"
          break
        fi
        in_osc=0
        osc_body=""
      elif [[ "$char" == $'\033' ]]; then
        osc_saw_esc=1
      else
        osc_body="${osc_body}${char}"
      fi
    elif [[ $saw_esc -eq 1 ]]; then
      if [[ "$char" == "]" ]]; then
        in_osc=1
        osc_body=""
        osc_saw_esc=0
      fi
      saw_esc=0
    elif [[ "$char" == $'\033' ]]; then
      saw_esc=1
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
  local query="$1"
  local search_by="${2:-any}"
  local limit="${3:-10}"
  floyd_call find_elements "{\"query\":\"$(_floyd_json_escape "$query")\",\"search_by\":\"$(_floyd_json_escape "$search_by")\",\"limit\":$limit}"
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
  local level="${2:-AA}"
  floyd_call check_contrast "{\"selector\":\"$selector\",\"level\":\"$level\"}"
}

floyd_fill_form() {
  if [[ $# -eq 1 ]]; then
    floyd_call fill_form "{\"fields\":$1}"
    return
  fi

  if (( $# == 0 || $# % 2 != 0 )); then
    echo '{"ok":false,"error":"usage: floyd_fill_form <json_array> OR <selector value>..."}'
    return 1
  fi

  local fields='['
  local first=1
  while (( $# > 0 )); do
    local selector="$1"
    local value="$2"
    shift 2

    if [[ $first -eq 0 ]]; then
      fields+=','
    fi
    first=0
    fields+="{\"selector\":\"$(_floyd_json_escape "$selector")\",\"value\":\"$(_floyd_json_escape "$value")\"}"
  done
  fields+=']'

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

  local args="{\"query\":\"$(_floyd_json_escape "$query")\",\"top_k\":$top_k,\"limit\":$top_k"
  if [[ -n "$collection" ]]; then
    args="${args},\"collection\":\"$(_floyd_json_escape "$collection")\""
  fi
  args="${args}}"

  floyd_call query_knowledge "$args"
}

floyd_write_observation() {
  local summary="${1:-}"
  floyd_call write_observation "{\"summary\":\"$(_floyd_json_escape "$summary")\"}"
}

floyd_read_commands() {
  floyd_call read_commands '{}'
}

floyd_shell() {
  local command="$*"
  floyd_call execute_local_shell "{\"command\":\"$(_floyd_json_escape "$command")\"}"
}

floyd_tab_state() {
  if [[ -n "$1" ]]; then
    floyd_call get_tab_state "{\"tab_id\":$1}"
  else
    floyd_call get_tab_state '{}'
  fi
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
  echo "  floyd_find <query> [by] [n]    — Find elements"
  echo "  floyd_extract_text [selector]  — Extract text content"
  echo "  floyd_extract_css <selector>   — Get computed CSS"
  echo "  floyd_contrast [sel] [AA|AAA]  — Check contrast ratios"
  echo "  floyd_fill_form <json|pairs>   — Fill multiple form fields"
  echo "  floyd_select <sel> <value>     — Select dropdown option"
  echo "  floyd_scroll [target]          — Scroll to position"
  echo "  floyd_wait <selector> [ms]     — Wait for element"
  echo "  floyd_tabs                     — List open tabs"
  echo "  floyd_open_tab <url>           — Open new tab"
  echo "  floyd_close_tab <id>           — Close tab"
  echo "  floyd_switch_tab <id>          — Switch to tab"
  echo "  floyd_page_state               — Current page state"
  echo "  floyd_tab_state [id]           — State for current/specific tab"
  echo "  floyd_element <selector>       — Deep element analysis"
  echo "  floyd_query <text> [coll] [k]  — Query knowledge base"
  echo "  floyd_write_observation [txt]  — Persist page observation markdown"
  echo "  floyd_read_commands            — Read queued markdown commands"
  echo "  floyd_shell <command...>       — Run silent local shell command"
  echo "  floyd_status                   — This help"
}

# Announce availability
if [[ -n "$FLOYD_TTY_BRIDGE" ]]; then
  echo "[floyd-tools] 24 browser tools + knowledge base ready. Run floyd_status for help."
fi
