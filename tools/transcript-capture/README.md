# Tom the Peep — Transcript Capture Tool

**Version 1.0** | Non-invasive transcript capture for the Tom the Peep Vision Agent

---

## What This Tool Does

Captures Tom the Peep's text transcript, tool calls, memory checkpoints, and session events in real-time — without modifying Tom's source code or interfering with his audio output.

Works by injecting a lightweight observer into the running browser tab via macOS AppleScript. The observer wraps `console.log` with a safe, non-destructive passthrough that pattern-matches Tom's known output signatures and stores them in a ring buffer.

```
┌──────────────────┐       ┌────────────────────┐       ┌──────────────┐
│  Tom the Peep    │       │  Injected Observer  │       │  Your Shell  │
│  (Gemini Live)   │──────►│  (window scope)     │──────►│  or Agent    │
│                  │ T:... │  Ring buffer (500)  │ poll  │              │
│  Audio + Text    │       │  CustomEvent bus    │       │  JSONL file  │
└──────────────────┘       └────────────────────┘       └──────────────┘
```

---

## Prerequisites

| Requirement | How to Verify |
|---|---|
| macOS 11+ | `sw_vers` |
| Google Chrome 116+ | `chrome://version` |
| Tom the Peep tab open | Navigate to the Tom URL |
| **Allow JavaScript from Apple Events** | Chrome > View > Developer > check the option |

The "Allow JavaScript from Apple Events" setting is **required** — this is how the tool communicates with Chrome. It's a one-time toggle.

---

## Quick Start

```bash
cd /path/to/floyd-tty-bridge/tools/transcript-capture

# 1. Inject the capture payload into Tom's tab
./capture.sh

# 2. Talk to Tom...

# 3. Retrieve the transcript
./poll.sh --text
```

---

## For Human Users

### One-Time Setup

1. Open Chrome
2. Go to **View > Developer > Allow JavaScript from Apple Events** (check it)
3. Open Tom the Peep in a Chrome tab

### Starting a Capture Session

**Option A — Manual polling:**

```bash
# Inject the observer
./capture.sh

# ... have your conversation with Tom ...

# Check how many entries captured
./poll.sh --count

# View transcript as readable text
./poll.sh --text

# Get raw JSON
./poll.sh --dump
```

**Option B — Automatic recording to file:**

```bash
# Start recording (polls every 5 seconds, saves to ./transcripts/)
./transcript-capture.sh

# Custom interval and output file
./transcript-capture.sh --interval 3 --output ~/Desktop/tom-session.jsonl

# Press Ctrl+C to stop — final entries are saved automatically
```

### Reading Your Transcripts

Saved files use JSONL format (one JSON object per line):

```json
{"type":"session","text":"Live session connected","ts":1710000000000,"iso":"2026-03-11T12:00:00.000Z"}
{"type":"transcript","role":"assistant","text":"Hello! I can see your screen...","ts":1710000001000,"iso":"2026-03-11T12:00:01.000Z"}
{"type":"tool_call","text":"[Vision Agent] Tool call: analyze_page {...}","ts":1710000002000,"iso":"2026-03-11T12:00:02.000Z"}
```

### Stopping Capture

```bash
# Disable the observer and restore original console.log
./capture.sh --kill
```

### Emergency Kill Switch

If Tom's audio stops working after injection, run this in Chrome's DevTools console (Cmd+Option+J):

```javascript
window.__tomTranscriptRestore()
```

Or from Terminal:

```bash
./capture.sh --kill
```

---

## For LLM Agents (Claude Code, etc.)

### Injecting the Capture Payload

Use `osascript` to inject the JavaScript payload from `inject.js` into Chrome:

```bash
osascript << 'APPLESCRIPT'
tell application "Google Chrome"
    tell active tab of front window
        execute javascript "<contents of inject.js>"
    end tell
end tell
APPLESCRIPT
```

Or use the provided script:

```bash
/path/to/floyd-tty-bridge/tools/transcript-capture/capture.sh
```

**Expected response:** `CAPTURE_ACTIVE:ring_buffer=500:kill_switch=window.__tomTranscriptOff=true`

If already injected: `ALREADY_ACTIVE:N entries`

### Polling for Transcript Data

**Get all entries (JSON):**
```bash
osascript -e 'tell application "Google Chrome" to tell active tab of front window to execute javascript "window.__tomTranscript.dump()"'
```

**Get entries since a timestamp (milliseconds):**
```bash
osascript -e 'tell application "Google Chrome" to tell active tab of front window to execute javascript "JSON.stringify(window.__tomTranscript.since(1710000000000))"'
```

**Get human-readable text:**
```bash
osascript -e 'tell application "Google Chrome" to tell active tab of front window to execute javascript "window.__tomTranscript.text()"'
```

**Drain (get + clear):**
```bash
osascript -e 'tell application "Google Chrome" to tell active tab of front window to execute javascript "JSON.stringify(window.__tomTranscript.drain())"'
```

**Entry count:**
```bash
osascript -e 'tell application "Google Chrome" to tell active tab of front window to execute javascript "window.__tomTranscript.count()"'
```

**Last N entries:**
```bash
osascript -e 'tell application "Google Chrome" to tell active tab of front window to execute javascript "JSON.stringify(window.__tomTranscript.entries.slice(-5))"'
```

### Inline Injection (No File Dependency)

If you need to inject without reading `inject.js` from disk, here's the minimal payload an agent can inject directly:

```javascript
(function(){
  if(window.__tomTranscriptActive) return 'ALREADY_ACTIVE';
  window.__tomTranscript={entries:[],startedAt:Date.now(),
    push:function(e){e.ts=e.ts||Date.now();e.iso=new Date(e.ts).toISOString();this.entries.push(e);if(this.entries.length>500)this.entries.shift()},
    dump:function(){return JSON.stringify(this.entries)},
    since:function(t){return this.entries.filter(function(e){return e.ts>=t})},
    text:function(){return this.entries.map(function(e){return'['+e.iso+'] ['+e.type+'] '+(e.text||'')}).join('\\n')},
    drain:function(){var c=this.entries.slice();this.entries.length=0;return c},
    count:function(){return this.entries.length},
    clear:function(){this.entries.length=0}
  };
  window.__tomTranscriptActive=true;
  window.__tomTranscriptOff=false;
  var _l=console.log;
  console.log=function(){_l.apply(console,arguments);try{if(window.__tomTranscriptOff)return;var a=arguments[0];
    if(a==='T:'&&arguments.length>=2)window.__tomTranscript.push({type:'transcript',role:'assistant',text:String(arguments[1])});
    else if(a==='A:'&&arguments.length>=2)window.__tomTranscript.push({type:'audio_chunk',text:'Audio: '+arguments[1]+' bytes'});
    else if(typeof a==='string'&&a.indexOf('[Vision Agent]')===0)window.__tomTranscript.push({type:'tool_call',text:Array.prototype.slice.call(arguments).join(' ')});
    else if(typeof a==='string'&&a.indexOf('[Memory]')===0)window.__tomTranscript.push({type:'memory',text:Array.prototype.slice.call(arguments).join(' ')});
    else if(typeof a==='string'&&a.indexOf('Live session')===0)window.__tomTranscript.push({type:'session',text:String(a)});
  }catch(_){}};
  window.__tomTranscriptRestore=function(){console.log=_l;window.__tomTranscriptOff=true;window.__tomTranscriptActive=false;return'Restored'};
  return 'CAPTURE_ACTIVE';
})();
```

### Recommended Agent Workflow

```
1. Inject payload       → capture.sh  or  inline JS via osascript
2. Confirm active       → check response contains "CAPTURE_ACTIVE"
3. User talks to Tom    → wait / do other work
4. Poll periodically    → poll.sh --last 10  or  osascript one-liner
5. Process transcript   → parse JSON entries
6. When done            → capture.sh --kill  or  window.__tomTranscriptRestore()
```

### Response JSON Schema

Each entry in the transcript array:

```typescript
interface TranscriptEntry {
  type: 'transcript' | 'audio_chunk' | 'tool_call' | 'memory' | 'session';
  text: string;            // The captured text content
  role?: 'assistant';      // Present only for type: 'transcript'
  ts: number;              // Unix timestamp in milliseconds
  iso: string;             // ISO 8601 timestamp
}
```

---

## How It Works (Architecture)

### What Gets Captured

| Pattern | Type | Source |
|---|---|---|
| `console.log('T:', text)` | `transcript` | `onMessage` callback (App.tsx:86) |
| `console.log('A:', length)` | `audio_chunk` | `onAudioData` callback (App.tsx:87) |
| `console.log('[Vision Agent] Tool call: ...')` | `tool_call` | Tool execution (liveService.ts:254) |
| `console.log('[Memory] ...')` | `memory` | Memory checkpoint (liveService.ts:611) |
| `console.log('Live session ...')` | `session` | Connection events (liveService.ts:232,306) |

### Safety Design

1. **Original-first execution**: The existing `console.log` (or extension wrapper) is called FIRST, synchronously, before any capture logic runs. Tom's entire pipeline completes before our code touches anything.

2. **Try/catch isolation**: All capture logic is wrapped in try/catch. If our pattern matching throws, it's silently caught — Tom never sees the error.

3. **No argument mutation**: We never modify the arguments passed to console.log. We read them, pattern-match, and create new objects for our buffer.

4. **Kill switch**: `window.__tomTranscriptOff = true` instantly disables all capture without removing the wrapper. `window.__tomTranscriptRestore()` fully removes the wrapper.

5. **Idempotency**: Re-injecting returns `ALREADY_ACTIVE` instead of double-wrapping.

### Important Limitation: Audio-Only Mode

Tom's Gemini Live session uses `responseModalities: [Modality.AUDIO]`. This means Gemini primarily sends audio PCM data, not text. The `T:` text transcript entries may be **sparse or absent** for normal speech responses. You will reliably capture:

- Tool call results (always text-based)
- Memory checkpoints (always text-based)
- Session connect/disconnect events
- Audio chunk activity indicators

To get full speech-to-text transcript, the app would need `Modality.TEXT` added to `responseModalities` in `liveService.ts` line 221.

---

## File Reference

```
tools/transcript-capture/
├── README.md                  # This file
├── inject.js                  # Full capture payload (readable, commented)
├── capture.sh                 # Inject/kill/status wrapper
├── poll.sh                    # Retrieve transcript data
├── transcript-capture.sh      # All-in-one: inject + poll loop + save
└── transcripts/               # Default output directory (auto-created)
    └── tom_transcript_*.jsonl # Saved session files
```

---

## Troubleshooting

### Tom stops responding after injection

Run the kill switch immediately:

```bash
./capture.sh --kill
```

Or in Chrome DevTools Console:

```javascript
window.__tomTranscriptRestore()
```

### "Executing JavaScript through AppleScript is turned off"

Enable in Chrome: **View > Developer > Allow JavaScript from Apple Events**

### Transcript is empty / only shows session events

This is expected behavior when Tom is in audio-only mode. Gemini sends PCM audio, not text. You'll see `audio_chunk` entries (activity indicators) and any tool calls or memory checkpoints, but raw speech transcript requires `Modality.TEXT` to be added to the Gemini session config.

### "Not active" when polling

The capture payload needs to be re-injected after page reload. Run `./capture.sh` again.

### Capture survives page navigation?

No. If Tom's page reloads or navigates, the injected JS is lost. Re-inject with `./capture.sh`.

---

*Tom the Peep Transcript Capture Tool v1.0 — Floyd's Labs*
