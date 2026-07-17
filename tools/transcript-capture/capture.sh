#!/bin/bash
# capture.sh — Inject transcript capture into Tom the Peep's Chrome tab
#
# Usage:
#   ./capture.sh              # Inject into active tab
#   ./capture.sh --tab-url    # Inject into tab matching Tom's URL pattern
#   ./capture.sh --kill       # Disable capture and restore console.log
#   ./capture.sh --status     # Check if capture is active
#
# Prerequisites:
#   - Google Chrome running with Tom the Peep tab open
#   - Chrome > View > Developer > Allow JavaScript from Apple Events (enabled)

set -euo pipefail

# ── Minified Payload ─────────────────────────────────────────────────────────
# This is the minified version of inject.js. Using inline JS avoids AppleScript
# heredoc quoting issues with multiline JavaScript.

INJECT_PAYLOAD="(function(){if(window.__tomTranscriptActive)return'ALREADY_ACTIVE:'+window.__tomTranscript.entries.length+' entries';window.__tomTranscript={entries:[],startedAt:Date.now(),push:function(e){e.ts=e.ts||Date.now();e.iso=new Date(e.ts).toISOString();this.entries.push(e);if(this.entries.length>500)this.entries.shift();try{window.dispatchEvent(new CustomEvent('tom-transcript',{detail:e}))}catch(_){}},dump:function(){return JSON.stringify(this.entries)},since:function(t){return this.entries.filter(function(e){return e.ts>=t})},text:function(){return this.entries.map(function(e){return'['+e.iso+'] ['+e.type+'] '+(e.text||'')}).join('\\\\n')},drain:function(){var c=this.entries.slice();this.entries.length=0;return c},count:function(){return this.entries.length},clear:function(){this.entries.length=0}};window.__tomTranscriptActive=true;window.__tomTranscriptOff=false;var _l=console.log;console.log=function(){_l.apply(console,arguments);try{if(window.__tomTranscriptOff)return;var a=arguments[0];if(a==='T:'&&arguments.length>=2)window.__tomTranscript.push({type:'transcript',role:'assistant',text:String(arguments[1])});else if(a==='A:'&&arguments.length>=2)window.__tomTranscript.push({type:'audio_chunk',text:'Audio: '+arguments[1]+' bytes'});else if(typeof a==='string'&&a.indexOf('[Vision Agent]')===0)window.__tomTranscript.push({type:'tool_call',text:Array.prototype.slice.call(arguments).join(' ')});else if(typeof a==='string'&&a.indexOf('[Memory]')===0)window.__tomTranscript.push({type:'memory',text:Array.prototype.slice.call(arguments).join(' ')});else if(typeof a==='string'&&a.indexOf('Live session')===0)window.__tomTranscript.push({type:'session',text:String(a)})}catch(_){}};window.__tomTranscriptRestore=function(){console.log=_l;window.__tomTranscriptOff=true;window.__tomTranscriptActive=false;return'Restored'};window.__tomTranscript.push({type:'session',text:'Transcript capture injected'});return'CAPTURE_ACTIVE'})();"

# ── Helpers ──────────────────────────────────────────────────────────────────

run_js_in_active_tab() {
  osascript -e "tell application \"Google Chrome\" to tell active tab of front window to execute javascript \"$1\""
}

run_js_in_tom_tab() {
  osascript << APPLESCRIPT
tell application "Google Chrome"
    set tomTab to missing value
    repeat with w in windows
        repeat with t in tabs of w
            if URL of t contains "ragbot3000" or URL of t contains "vision-agent" then
                set tomTab to t
                exit repeat
            end if
        end repeat
        if tomTab is not missing value then exit repeat
    end repeat

    if tomTab is missing value then
        error "Tom the Peep tab not found. Is it open?"
    end if

    tell tomTab
        execute javascript "$1"
    end tell
end tell
APPLESCRIPT
}

# ── Commands ─────────────────────────────────────────────────────────────────

case "${1:-inject}" in
  --kill|-k)
    echo "Disabling transcript capture..."
    run_js_in_active_tab "window.__tomTranscriptRestore ? window.__tomTranscriptRestore() : 'Not active'"
    ;;

  --status|-s)
    run_js_in_active_tab "window.__tomTranscriptActive ? 'ACTIVE:' + window.__tomTranscript.count() + ' entries since ' + new Date(window.__tomTranscript.startedAt).toISOString() : 'INACTIVE'"
    ;;

  --tab-url|-t)
    echo "Searching for Tom the Peep tab..."
    run_js_in_tom_tab "$INJECT_PAYLOAD"
    ;;

  inject|--inject|-i|"")
    run_js_in_active_tab "$INJECT_PAYLOAD"
    ;;

  *)
    echo "Usage: capture.sh [inject|--kill|--status|--tab-url]"
    exit 1
    ;;
esac
