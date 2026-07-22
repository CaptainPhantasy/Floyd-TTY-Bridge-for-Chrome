# Floyd's Labs TTY Bridge — Advanced Features & Hidden Capabilities

**Version 5.1.0** | Deep Technical Reference

This document catalogs features that exist in the codebase but are not prominently documented in the main README or onboarding guides. These are "latent" capabilities — fully functional, but intended for advanced users, specific workflows, or future expansion.

---

## Table of Contents

1. [Knowledge Systems](#1-knowledge-systems)
2. [Verification & Audit](#2-verification--audit)
3. [Visual Grounding Systems](#3-visual-grounding-systems)
4. [Token Optimization](#4-token-optimization)
5. [Network Interception](#5-network-interception)
6. [Session Resilience](#6-session-resilience)
7. [Workflow Automation](#7-workflow-automation)
8. [Media Capture](#8-media-capture)
9. [Debug & Diagnostics](#9-debug--diagnostics)
10. [Live Development](#10-live-development)
11. [Raw Protocol Access](#11-raw-protocol-access)
12. [WASM Execution](#12-wasm-execution)
13. [Internal Infrastructure](#13-internal-infrastructure)
14. [Undocumented Bash SDK Functions](#14-undocumented-bash-sdk-functions)

---

## 1. Knowledge Systems

### 1.1 Vectorized Knowledge Base Query

The extension includes access to a **12,000+ document vectorized knowledge base** via Tom the Peep's vision engine. This allows semantic search across a large corpus of documents.

**Bash Function:**
```bash
floyd_query "your question" [collection] [top_k]
```

**Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | Natural language question |
| `collection` | string | optional | Specific collection to search |
| `top_k` | number | 5 | Number of results to return |

**Examples:**
```bash
# Basic query
floyd_query "How do I file a tax extension?"

# Search specific collection with more results
floyd_query "React hooks best practices" "frontend_docs" 10
```

**Raw Tool Call:**
```bash
floyd_call query_knowledge '{"query": "your question", "top_k": 5}'
```

**Use Cases:**
- Looking up documentation without leaving the terminal
- Finding code examples from a knowledge corpus
- Semantic search across indexed project files

---

### 1.2 Ask Tom (Vision AI)

Direct query to the Gemini Live vision AI about what it "sees" on the current page.

**Bash Function:**
```bash
floyd_ask_tom "What do you see on this page?"
```

**Protocol:**
- In Bridge Mode: Sends via OSC escape sequence with type `ragbot_request`
- In Proxy Mode: Routes through file-based IPC to the side panel
- Requires Gemini Live session to be active for best results

**Example Session:**
```bash
source /usr/local/share/floyd/floyd-tools.sh

# Navigate to a page
floyd_navigate "https://news.ycombinator.com"

# Ask Tom what's there
floyd_ask_tom "What are the top stories right now?"
# Returns: {"ok": true, "result": {"text": "..."}}
```

**Response Format:**
```json
{
  "ok": true,
  "result": {
    "text": "I can see a news aggregator page with..."
  }
}
```

**Error States:**
```json
{"ok": false, "error": "Tom is not connected"}
{"ok": false, "error": "Tom did not respond in time"}
{"ok": false, "error": "Failed to send request to Tom"}
```

---

## 2. Verification & Audit

### 2.1 Claim Verification System

A structured system for recording verification results — designed for fact-checking workflows, audit trails, or research validation.

**Bash Function:**
```bash
floyd_verify_claim "claim_id" "claim_text" "source_doc" "code_reference" "status" "notes"
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `claim_id` | string | Unique identifier for the claim |
| `claim_text` | string | The actual claim being verified |
| `source_doc` | string | Document where claim originated |
| `code_reference` | string | Related code or section reference |
| `status` | string | Verification status (verified, refuted, uncertain, pending) |
| `notes` | string | Additional context or evidence |

**Example:**
```bash
floyd_verify_claim \
  "claim_001" \
  "API returns 200 on success" \
  "docs/api.md" \
  "src/handlers.go:45" \
  "verified" \
  "Confirmed via integration test"
```

**Raw Tool Call:**
```bash
floyd_call write_observation '{
  "type": "verification_report",
  "claim_id": "claim_001",
  "claim_text": "API returns 200 on success",
  "source_doc": "docs/api.md",
  "code_reference": "src/handlers.go:45",
  "status": "verified",
  "notes": "Confirmed via integration test"
}'
```

**Use Cases:**
- Documenting research findings
- Audit trails for compliance
- Fact-checking workflows
- Code review annotations

---

### 2.2 Observation Scratchpad

The underlying `write_observation` tool supports multiple observation types:

**Types:**
- `verification_report` — Structured claim verification
- `general` — Freeform notes
- `error_log` — Error documentation
- `metric` — Quantitative observations

**Example:**
```bash
floyd_call write_observation '{
  "type": "metric",
  "name": "page_load_time",
  "value": 1.23,
  "unit": "seconds",
  "context": "Homepage after cache clear"
}'
```

---

## 3. Visual Grounding Systems

### 3.1 Set-of-Marks Visual Labeling

Injects numbered visual labels onto page elements, enabling screenshot-based element targeting. This is the same technique used by GPT-4V and other multimodal models.

**Enable:**
```bash
floyd_call set_of_marks '{}'
```

**Result:**
- Every interactive/clickable element gets a numbered overlay
- Numbers are visible in screenshots
- Enables "click number 5" style commands

**Click by Mark:**
```bash
floyd_call click_mark '{"mark": 5}'
```

**Disable:**
```bash
# Refresh the page or navigate away
floyd_navigate "about:blank"
```

**Workflow Example:**
```bash
# 1. Navigate to page
floyd_navigate "https://example.com/form"

# 2. Enable visual marks
floyd_call set_of_marks '{}'

# 3. Take screenshot (marks will be visible)
floyd_screenshot

# 4. Click by mark number
floyd_call click_mark '{"mark": 3}'
```

**Use Cases:**
- Multimodal AI agents that use vision
- Accessibility auditing (see all interactive elements)
- Demo recordings with labeled elements

---

### 3.2 Reference-Based Element Targeting

Instead of fragile CSS selectors, use stable reference IDs from the accessibility tree. These refs persist across minor DOM changes.

**Get Accessibility Tree:**
```bash
floyd_call read_page '{}'
```

**Response Structure:**
```json
{
  "ok": true,
  "result": {
    "tree": {
      "role": "WebArea",
      "name": "Page Title",
      "children": [
        {
          "ref": "e1",
          "role": "button",
          "name": "Submit",
          "bounded": true
        }
      ]
    }
  }
}
```

**Target by Reference:**
```bash
# Click by ref ID
floyd_call click_ref '{"ref": "e1"}'

# Type by ref ID
floyd_call type_ref '{"ref": "e2", "text": "hello"}'

# Scroll to ref
floyd_call scroll_to_ref '{"ref": "e3"}'
```

**Advantages over CSS Selectors:**
| CSS Selector | Reference ID |
|--------------|--------------|
| Breaks on class name changes | Stable across minor DOM updates |
| Requires knowledge of page structure | Derived from accessibility tree |
| May match multiple elements | Unique per element |
| Fails on dynamic content | Recalculated on each read |

---

### 3.3 Accessibility Tree Extraction

Full accessibility tree with element references and properties.

**Bash Function:**
```bash
# Not directly exposed, use raw call
floyd_call read_page '{}'
```

**Response Fields:**
| Field | Description |
|-------|-------------|
| `ref` | Stable element reference ID |
| `role` | ARIA role (button, link, textbox, etc.) |
| `name` | Accessible name |
| `value` | Current value (for inputs) |
| `description` | Accessible description |
| `bounded` | Whether element has bounds |
| `children` | Nested elements |

---

## 4. Token Optimization

### 4.1 DOM Distillation

Filters the DOM to reduce token consumption by 60-80% while preserving essential information.

**Modes:**

| Mode | Description | Token Reduction |
|------|-------------|-----------------|
| `text_only` | Just text content, no structure | ~80% |
| `input_fields` | Only form inputs and labels | ~90% |
| `all_content` | Filtered full content | ~60% |

**Usage:**
```bash
# Text only
floyd_call distill_dom '{"mode": "text_only"}'

# Just inputs
floyd_call distill_dom '{"mode": "input_fields"}'

# Filtered full
floyd_call distill_dom '{"mode": "all_content"}'
```

**Example Output (text_only):**
```json
{
  "ok": true,
  "result": {
    "text": "Welcome to Example\n\nSign In\nUsername\nPassword\nSubmit\n\nForgot password?",
    "token_estimate": 25
  }
}
```

---

### 4.2 DOM Change Detection

Get structured deltas since last read — only what changed.

**Usage:**
```bash
floyd_call get_dom_changes '{}'
```

**Response:**
```json
{
  "ok": true,
  "result": {
    "added": [
      {"selector": "#notification", "text": "Success!"}
    ],
    "removed": [
      {"selector": ".loading-spinner"}
    ],
    "changed": [
      {"selector": "#count", "oldValue": "5", "newValue": "6"}
    ],
    "timestamp": 1699999999999
  }
}
```

**Use Cases:**
- Monitoring dynamic pages efficiently
- Detecting state changes without re-reading full DOM
- Minimal-context updates for LLM agents

---

## 5. Network Interception

### 5.1 Declarative Network Rules

Add, modify, or block network requests at the browser level using Chrome's `declarativeNetRequest` API.

**Add Rule:**
```bash
floyd_call add_net_rule '{
  "id": 1,
  "priority": 1,
  "action": {"type": "block"},
  "condition": {
    "urlFilter": "*tracking*",
    "resourceTypes": ["script", "image"]
  }
}'
```

**Action Types:**
| Type | Description |
|------|-------------|
| `block` | Block the request entirely |
| `redirect` | Redirect to another URL |
| `modifyHeaders` | Add/remove request or response headers |

**Modify Headers Example:**
```bash
floyd_call add_net_rule '{
  "id": 2,
  "priority": 1,
  "action": {
    "type": "modifyHeaders",
    "requestHeaders": [
      {"header": "X-Custom-Auth", "operation": "set", "value": "secret"}
    ],
    "responseHeaders": [
      {"header": "X-Frame-Options", "operation": "remove"}
    ]
  },
  "condition": {
    "urlFilter": "*api.example.com*"
  }
}'
```

**Remove Rule:**
```bash
floyd_call remove_net_rule '{"id": 1}'
```

---

### 5.2 Network Traffic Capture

Monitor network requests via Chrome DevTools Protocol.

**Start Monitoring:**
```bash
floyd_call start_network_monitor '{}'
```

**Read Captured Traffic:**
```bash
floyd_call read_network '{"urlPattern": "*api*"}'
```

**Response:**
```json
{
  "ok": true,
  "result": {
    "requests": [
      {
        "url": "https://api.example.com/data",
        "method": "GET",
        "status": 200,
        "type": "xhr",
        "time": 145.23,
        "size": 1234
      }
    ]
  }
}
```

**Stop Monitoring:**
```bash
floyd_call stop_network_monitor '{}'
```

**Use Cases:**
- Debugging API calls
- Performance analysis
- Security auditing
- Understanding third-party tracking

---

## 6. Session Resilience

### 6.1 Checkpoint Save/Restore

Save complete session state for crash recovery or workflow resumption.

**Save Checkpoint:**
```bash
floyd_call checkpoint_save '{"name": "before_risky_operation"}'
```

**Checkpoint Contents:**
- Current URL
- Scroll position
- Element references
- Tab group membership
- Form state (optional)

**Restore Checkpoint:**
```bash
floyd_call checkpoint_restore '{"name": "before_risky_operation"}'
```

**Workflow Example:**
```bash
# Save state before testing
floyd_call checkpoint_save '{"name": "pre_test"}'

# Do something risky
floyd_click "#dangerous-button"

# Check result
result=$(floyd_page_state)

# If failed, restore
if echo "$result" | grep -q "error"; then
  floyd_call checkpoint_restore '{"name": "pre_test"}'
  echo "Restored to safe state"
fi
```

---

### 6.2 Tab Group Management

Organize tabs into named, colored groups.

**Create Group:**
```bash
floyd_call create_tab_group '{
  "tabIds": [42, 43, 44],
  "title": "Research",
  "color": "blue",
  "collapsed": false
}'
```

**Manage Group:**
```bash
# Collapse
floyd_call manage_tab_group '{"groupId": 1, "action": "collapse"}'

# Expand
floyd_call manage_tab_group '{"groupId": 1, "action": "expand"}'

# Ungroup
floyd_call manage_tab_group '{"groupId": 1, "action": "ungroup"}'

# Update
floyd_call manage_tab_group '{"groupId": 1, "title": "New Name", "color": "green"}'
```

**Colors:** `grey`, `blue`, `red`, `yellow`, `green`, `pink`, `purple`, `cyan`

---

## 7. Workflow Automation

### 7.1 Action Recording

Record user or agent actions for replay or documentation.

**Start Recording:**
```bash
floyd_call record_start '{}'
```

**Stop Recording:**
```bash
floyd_call record_stop '{}'
```

**Export Recording:**

**As JSON:**
```bash
floyd_call record_export '{"format": "json"}'
```

**As Natural Language Prompt:**
```bash
floyd_call record_export '{"format": "prompt"}'
```

**Example Prompt Output:**
```
Navigate to https://example.com/login
Click on the username field
Type "testuser"
Click on the password field
Type "secretpass123"
Click the submit button
Wait for the dashboard to load
```

**Use Cases:**
- Creating reproducible test cases
- Generating documentation
- Training other agents
- Macro creation

---

### 7.2 Quick Mode Batch Commands

Execute multiple single-letter commands in sequence for rapid interaction.

**Available Commands:**

| Letter | Action |
|--------|--------|
| `C` | Click focused element |
| `T` | Type into focused element |
| `K` | Clear focused input |
| `S` | Scroll down |
| `N` | Next focusable element |
| `R` | Scroll up |
| `D` | Describe current element |
| `M` | Toggle set-of-marks |
| `X` | Close current modal/dialog |
| `P` | Page up |
| `Q` | Quit quick mode |

**Usage:**
```bash
floyd_call quick '{"commands": "CSTSNTS"}'
# Click, Scroll, Type, Scroll, Next, Type, Scroll
```

---

## 8. Media Capture

### 8.1 Screenshot Capture

**Basic:**
```bash
floyd_screenshot
```

**Raw Tool with Options:**
```bash
floyd_call take_screenshot '{}'
```

**Response:**
```json
{
  "ok": true,
  "result": {
    "screenshot": "data:image/png;base64,iVBORw0KGgo...",
    "format": "png"
  }
}
```

**Note:** The base64 data can be decoded to a file or passed directly to vision-capable models.

---

### 8.2 GIF Recording with Action Overlays

Create animated GIFs with labeled actions — more informative than static screenshots.

**Start Recording:**
```bash
floyd_call gif_start '{}'
```

**Add Frame with Action Label:**
```bash
floyd_call gif_add_frame '{"action": "Clicked submit button"}'
```

**Stop and Export:**
```bash
floyd_call gif_stop '{}'
```

**Response:**
```json
{
  "ok": true,
  "result": {
    "gif": "data:image/gif;base64,R0lGOD...",
    "frameCount": 15,
    "duration": 3.2
  }
}
```

**Use Cases:**
- Bug reproduction with context
- Tutorial creation
- Demo recordings
- Documentation with visual proof

---

### 8.3 Audio/Video with Gemini Live

The side panel includes full Gemini Live integration.

**UI Controls:**
| Button | Function |
|--------|----------|
| **LIVE** | Start/stop voice session with Gemini |
| **SCR** | Share screen with Gemini for vision |
| **CAM** | Share camera with Gemini |

**Programmatic Access:**

The `live-service.js` module handles:
- Real-time audio streaming with echo cancellation
- Video frame capture at 3 FPS
- Tool execution via `liveToolExecutor`

**Tool Execution by Gemini:**
When Gemini calls a tool during a Live session, it routes through:
```javascript
async function liveToolExecutor(toolName, args) {
  const result = await sendToolCall(toolName, args);
  if (result.result?.floyd_command) {
    // Inject command into terminal
    port.postMessage({ type: 'pty_input', data: cmd, session: 1 });
  }
  return result.result;
}
```

---

## 9. Debug & Diagnostics

### 9.1 Console Capture

The content script silently captures console output into a ring buffer.

**Buffer Details:**
- Capacity: 200 entries
- Levels: `log`, `warn`, `error`
- Auto-filters extension-originated messages

**Read Console:**
```bash
floyd_call read_console '{"level": "error", "limit": 50}'
```

**Response:**
```json
{
  "ok": true,
  "result": {
    "entries": [
      {
        "level": "error",
        "message": "Uncaught TypeError: undefined is not a function",
        "timestamp": 1699999999999,
        "source": "app.js:42"
      }
    ],
    "total": 15
  }
}
```

**Filters:**
| Parameter | Values |
|-----------|--------|
| `level` | `all`, `log`, `warn`, `error` |
| `limit` | Number of entries (default 100) |
| `since` | Timestamp filter |

---

### 9.2 UI Audit (Deterministic Visual Check)

Math-based sanity check for UI — no AI interpretation required.

**Usage:**
```bash
floyd_ui_audit
```

**Checks Performed:**

| Check | Description | Threshold |
|-------|-------------|-----------|
| Contrast | Foreground/background ratio | ≥ 3.0:1 |
| Centering | Layout not squashed to one side | Width > 33% |
| Overflow | Content not clipped | No hidden overflow |
| Content | Page has visible content | Text length > 0 |

**Response:**
```json
{
  "ok": true,
  "result": {
    "passed": true,
    "score": 85,
    "checks": {
      "contrast": {"passed": true, "minRatio": 4.5},
      "centering": {"passed": true, "widthPercent": 100},
      "overflow": {"passed": true, "issues": 0},
      "content": {"passed": true, "textLength": 1234}
    },
    "violations": []
  }
}
```

---

### 9.3 Agent Working Indicator

The extension shows visual feedback when an agent is working on the page.

**Implementation:**
```javascript
// From background.js
chrome.tabs.sendMessage(tab.id, { type: 'AGENT_WORKING' });
// ... perform operation ...
chrome.tabs.sendMessage(tab.id, { type: 'AGENT_DONE' });
```

**Content Script Handler:**
Shows a visual indicator on the page during agent operations.

---

## 10. Live Development

### 10.1 File Watcher Auto-Refresh

The native host monitors the extension directory and triggers browser refreshes on file changes.

**Watched Extensions:**
- `.html`
- `.css`
- `.js`
- `.py`
- `.sh`

**Implementation:**
```python
# From native_host.py
def file_watcher():
    watch_path = os.path.dirname(os.path.abspath(__file__))
    last_mtimes = {}

    while not shutdown_event.is_set():
        for root, dirs, files in os.walk(watch_path):
            if ".git" in dirs: dirs.remove(".git")
            if "node_modules" in dirs: dirs.remove("node_modules")

            for f in files:
                if f.endswith((".html", ".css", ".js", ".py", ".sh")):
                    # Check mtime, trigger refresh if changed
```

**Trigger:**
```python
send_message({"type": "file_changed", "path": watch_path})
```

**Result:**
Chrome reloads the active tab automatically.

**Configuration:**
- Poll interval: 1 second
- Ignores: `.git`, `node_modules`

---

### 10.2 Extension Hot Reload

Reload the entire Floyd extension without restarting Chrome.

**Bash:**
```bash
floyd_reload
```

**Raw:**
```bash
floyd_call reload_extension '{}'
```

**Implementation:**
```javascript
// From background.js
case 'reload_extension': {
  setTimeout(() => chrome.runtime.reload(), 200);
  return { success: true, result: { reloading: true } };
}
```

**Use Case:**
After modifying extension code, reload to pick up changes.

---

## 11. Raw Protocol Access

### 11.1 Chrome DevTools Protocol (CDP)

Send arbitrary CDP commands directly to any tab.

**Usage:**
```bash
floyd_call debug_command '{
  "tabId": 42,
  "method": "Network.enable",
  "params": {}
}'
```

**Common Commands:**

| Domain | Method | Purpose |
|--------|--------|---------|
| `Network` | `enable` / `disable` | Traffic capture |
| `Network` | `setRequestInterception` | Intercept/modify requests |
| `Page` | `captureScreenshot` | Full page screenshot |
| `Page` | `printToPDF` | Generate PDF |
| `Emulation` | `setDeviceMetricsOverride` | Simulate device |
| `Runtime` | `evaluate` | Execute JavaScript |
| `DOM` | `getDocument` | Full DOM tree |

**Example: Full Page Screenshot:**
```bash
floyd_call debug_command '{
  "method": "Page.captureScreenshot",
  "params": {
    "format": "png",
    "captureBeyondViewport": true,
    "clip": {
      "x": 0,
      "y": 0,
      "width": 1920,
      "height": 10000,
      "scale": 1
    }
  }
}'
```

**Example: Execute JavaScript:**
```bash
floyd_call debug_command '{
  "method": "Runtime.evaluate",
  "params": {
    "expression": "document.querySelectorAll(\"a\").length"
  }
}'
```

---

### 11.2 Local Shell Execution

Execute shell commands outside the PTY with output capture.

**Usage:**
```bash
floyd_call execute_local_shell '{"command": "ls -la"}'
```

**Response:**
```json
{
  "success": true,
  "result": {
    "stdout": "total 48\ndrwxr-xr-x  12 user  ...",
    "stderr": "",
    "exitCode": 0
  }
}
```

**Timeout:** 30 seconds

**Note:** This runs in a separate subprocess, not the PTY. Useful for commands that need clean output capture.

---

## 12. WASM Execution

### 12.1 Offscreen WASM Execution

Execute WASM modules in an offscreen document.

**Current PoC:** SHA-256 hashing

**Usage:**
```bash
floyd_call wasm_exec '{
  "module": "sha256.wasm",
  "function": "hash",
  "input": "hello world"
}'
```

**Infrastructure:**
- Offscreen document created with `WORKERS` and `BLOBS` reasons
- Located in `extension/wasm/`
- Loader: `sha256-loader.js`
- Binary: `sha256.wasm`

**Extension Potential:**
The infrastructure is generic — other WASM modules could be added for:
- Image processing
- Cryptographic operations
- Data compression
- Custom algorithms

---

## 13. Internal Infrastructure

### 13.1 Large Response Handling

Responses exceeding 128KB automatically spill to temp files.

**Threshold:**
```python
# From native_host.py
LARGE_PAYLOAD_THRESHOLD = 128 * 1024  # 128 KB
```

**Mechanism:**
```python
if len(serialized) > LARGE_PAYLOAD_THRESHOLD:
    filepath = os.path.join(TEMP_DIR, f"result_{request_id}.json")
    # Write to file
    # Return pointer: {"ok": true, "file": "/tmp/floyd-xxx/result_xxx.json"}
```

**Client Handling (floyd-tools.sh):**
```bash
if echo "$response" | grep -q '"file":'; then
  filepath=$(echo "$response" | python3 -c "import sys,json; print(json.load(sys.stdin).get('file',''))")
  if [[ -n "$filepath" && -f "$filepath" ]]; then
    cat "$filepath"
    return 0
  fi
fi
```

---

### 13.2 Process Supervision

The native host includes a process supervisor to prevent zombie processes.

**Implementation:**
```python
class ProcessSupervisor:
    def __init__(self):
        self._processes: dict[int, subprocess.Popen[str]] = {}
        self._lock = threading.Lock()

    def add_process(self, proc):
        with self._lock:
            self._processes[proc.pid] = proc

    def check_zombies(self):
        # Reap finished processes

    def terminate_all(self):
        # Kill all on shutdown
```

**Watchdog Thread:**
```python
def watchdog():
    while not shutdown_event.is_set():
        supervisor.check_zombies()
        time.sleep(5)
```

---

### 13.3 OSC Escape Sequence Protocol

The bridge uses custom OSC sequences for communication.

**Command (Agent → Browser):**
```
\x1b]7701;{"id":"req_123","tool":"click","args":{...}}\x07
```

**Response (Browser → Agent):**
```
\x1b]7702;{"id":"req_123","ok":true,"result":{...}}\x07
```

**Terminators:**
- Standard: `\x07` (BEL)
- Alternative: `\x1b\\` (ST - String Terminator)

**Parser:**
```python
class OSCParser:
    def feed(self, char: str) -> Optional[tuple[str, dict]]:
        # State machine to extract OSC sequences from PTY stream
```

---

### 13.4 Native Messaging Protocol

Chrome native messaging uses 4-byte length prefix + UTF-8 JSON.

**Send:**
```python
def send_message(message):
    encoded = orjson.dumps(message)
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))  # 4-byte LE length
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()
```

**Receive:**
```python
def read_message():
    header = _read_exact(sys.stdin.buffer, 4)
    length = struct.unpack("<I", header)[0]
    data = _read_exact(sys.stdin.buffer, length)
    return orjson.loads(data)
```

**Limit:** 1 MB max message size (Chrome constraint)

---

## 14. Undocumented Bash SDK Functions

### 14.1 Raw Tool Call

All tools can be accessed via `floyd_call`:

```bash
floyd_call <tool_name> '[json_args]'
```

**Examples:**
```bash
floyd_call analyze_page '{"include_css":true}'
floyd_call click_element '{"selector":"#btn"}'
floyd_call query_knowledge '{"query":"test","top_k":10}'
```

---

### 14.2 DOM-Only Analysis

Lighter than full analysis:

```bash
floyd_dom
# Equivalent to:
floyd_call analyze_page '{"include_css":false,"include_accessibility":false}'
```

---

### 14.3 CSS Extraction

Get computed styles for any element:

```bash
floyd_extract_css "#header"
```

**Response:**
```json
{
  "ok": true,
  "result": {
    "background-color": "rgba(0, 0, 0, 0.8)",
    "color": "rgb(255, 255, 255)",
    "font-size": "16px",
    "display": "flex"
  }
}
```

---

### 14.4 Contrast Check

WCAG contrast ratio for specific elements:

```bash
floyd_contrast "body"
floyd_contrast ".headline"
floyd_contrast "#submit-btn"
```

**Response:**
```json
{
  "ok": true,
  "result": {
    "ratio": 7.2,
    "aa": true,
    "aaa": true,
    "foreground": "#333333",
    "background": "#ffffff"
  }
}
```

---

### 14.5 Accessibility Audit with Level

```bash
# WCAG AA (default)
floyd_a11y

# WCAG AAA
floyd_a11y "AAA"
```

---

### 14.6 Element Analysis

Deep dive on a single element:

```bash
floyd_element "#main-content"
```

**Response includes:**
- Computed styles
- Accessibility properties
- Bounding rectangle
- Parent/child relationships
- Event listeners (if accessible)

---

### 14.7 Status Check

Display current SDK status:

```bash
floyd_status
```

**Output:**
```
Floyd's Labs TTY Bridge v5.1.0 — Agent SDK
  Mode:   bridge
  Bridge: 4.6
  Proxy:  /Users/you/floyd_comm
  Shell:  /bin/zsh (PID 12345)

Available commands:
  floyd_call <tool> [json_args]  — Raw tool call
  floyd_analyze_page             — Full page analysis
  floyd_dom                      — DOM structure
  ...
```

---

## Appendix: Complete Tool List

| Tool | Bash Function | Category |
|------|---------------|----------|
| `analyze_page` | `floyd_analyze_page` | Analysis |
| `check_accessibility` | `floyd_a11y` | Accessibility |
| `check_contrast` | `floyd_contrast` | Accessibility |
| `analyze_element` | `floyd_element` | Analysis |
| `extract_text` | `floyd_extract_text` | Analysis |
| `extract_css` | `floyd_extract_css` | Analysis |
| `get_page_state` | `floyd_page_state` | Analysis |
| `find_elements` | `floyd_find` | Analysis |
| `read_page` | — | Analysis |
| `read_console` | — | Debug |
| `distill_dom` | — | Optimization |
| `get_dom_changes` | — | Optimization |
| `click_element` | `floyd_click` | Interaction |
| `type_text` | `floyd_type` | Interaction |
| `fill_form` | `floyd_fill_form` | Interaction |
| `select_option` | `floyd_select` | Interaction |
| `scroll_to` | `floyd_scroll` | Interaction |
| `navigate_to` | `floyd_navigate` | Navigation |
| `wait_for_element` | `floyd_wait` | Interaction |
| `click_ref` | — | Interaction |
| `type_ref` | — | Interaction |
| `scroll_to_ref` | — | Interaction |
| `set_of_marks` | — | Vision |
| `click_mark` | — | Vision |
| `quick` | — | Interaction |
| `take_screenshot` | `floyd_screenshot` | Capture |
| `list_tabs` | `floyd_tabs` | Tabs |
| `open_tab` | `floyd_open_tab` | Tabs |
| `close_tab` | `floyd_close_tab` | Tabs |
| `switch_tab` | `floyd_switch_tab` | Tabs |
| `get_tab_state` | — | Tabs |
| `create_tab_group` | — | Tabs |
| `manage_tab_group` | — | Tabs |
| `start_network_monitor` | — | Network |
| `stop_network_monitor` | — | Network |
| `read_network` | — | Network |
| `add_net_rule` | — | Network |
| `remove_net_rule` | — | Network |
| `debug_command` | — | Advanced |
| `execute_local_shell` | — | Advanced |
| `download` | — | IO |
| `download_status` | — | IO |
| `checkpoint_save` | — | Resilience |
| `checkpoint_restore` | — | Resilience |
| `record_start` | — | Automation |
| `record_stop` | — | Automation |
| `record_export` | — | Automation |
| `gif_start` | — | Media |
| `gif_add_frame` | — | Media |
| `gif_stop` | — | Media |
| `wasm_exec` | — | Compute |
| `query_knowledge` | `floyd_query` | Knowledge |
| `ask_tom` | `floyd_ask_tom` | Vision AI |
| `write_observation` | `floyd_verify_claim` | Audit |
| `read_commands` | — | Audit |
| `audit_ui` | `floyd_ui_audit` | Validation |
| `reload_extension` | `floyd_reload` | System |

---

*Floyd's Labs TTY Bridge v5.1.0 — Advanced Features Reference*
