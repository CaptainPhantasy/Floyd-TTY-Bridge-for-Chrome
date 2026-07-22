# Floyd's Labs TTY Bridge — Onboarding Guide

**Version 5.1.0** | AI Agent Browser Bridge for macOS

---

## Table of Contents

1. [What Is This?](#what-is-this)
2. [Human Onboarding](#human-onboarding)
3. [LLM Agent Onboarding](#llm-agent-onboarding)
4. [Architecture Overview](#architecture-overview)
5. [Tool Reference](#tool-reference)
6. [Troubleshooting](#troubleshooting)

---

## What Is This?

Floyd's Labs TTY Bridge is a **Chrome extension** that gives AI agents and LLMs direct control over a web browser. It works by:

1. **Hosting a terminal inside Chrome's side panel** with a full PTY (pseudo-terminal)
2. **Bridging shell commands to browser APIs** via native messaging
3. **Providing a Bash/Zsh SDK** for agents to control the browser programmatically

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          YOUR COMPUTER                                       │
│  ┌─────────────┐         ┌──────────────┐         ┌───────────────────────┐ │
│  │   Shell     │ ◄─────► │ native_host  │ ◄─────► │   Chrome Extension    │ │
│  │   (zsh)     │   OSC   │   (Python)   │  Native │   (Manifest V3)       │ │
│  │             │   7701  │              │  Msg    │                       │ │
│  └─────────────┘         └──────────────┘         │  ┌─────────────────┐  │ │
│       ▲                                            │  │ background.js   │  │ │
│       │ source                                     │  │  (Service       │  │ │
│       │                                            │  │   Worker)       │  │ │
│  ┌────┴────────┐                                   │  └────────┬────────┘  │ │
│  │floyd-tools.sh│                                  │           │           │ │
│  │ (Agent SDK)  │                                  │  ┌────────┴────────┐  │ │
│  └─────────────┘                                   │  │                 │  │ │
│                                                    │  ▼                 ▼  │ │
│                                                    │ [Side Panel]  [Content │ │
│                                                    │  (xterm.js)   Script]  │ │
│                                                    └───────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Human Onboarding

### Prerequisites

| Requirement | Version | How to Check |
|-------------|---------|--------------|
| macOS | 11+ (Big Sur) | `sw_vers` |
| Google Chrome | 116+ | `chrome://version` |
| Python 3 | 3.8+ | `python3 --version` |

### Step 1: Install the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `extension/` folder from this project
5. **Copy the Extension ID** shown under the extension name (looks like `abcdefghijklmnopqrstuvwxyz123456`)

### Step 2: Install the Native Messaging Host

Run the installer from the `extension/` directory:

```bash
cd /path/to/floyd-tty-bridge/extension
./install.sh
```

The installer will:
- Install `native_host.py` to `/usr/local/bin/floyd_tty_host.py`
- Install the agent SDK to `/usr/local/share/floyd/floyd-tools.sh`
- Create native messaging manifests for Chrome/Chromium/Brave
- Prompt for your extension ID if auto-detection fails

### Step 3: Verify Installation

```bash
# Check the manifest is valid
python3 -m json.tool ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.floyd.tty.json

# Quick sanity test (will error but shows host starts)
echo '{"type":"ping"}' | python3 /usr/local/bin/floyd_tty_host.py 2>/dev/null || true
```

### Step 4: First Run

1. Open Chrome
2. Press `Cmd+Shift+Y` to open Floyd's TTY side panel
3. Wait for the green "CONNECTED" status
4. In the terminal, run:

```bash
source /usr/local/share/floyd/floyd-tools.sh
floyd_status
```

You should see:
```
Floyd's Labs TTY Bridge v5.1.0 — Agent SDK
  Mode:   bridge
  Bridge: 4.7
  ...
```

### Step 5: Try It Out

```bash
# Navigate to a page
floyd_navigate "https://example.com"

# Analyze the page
floyd_analyze_page

# Take a screenshot
floyd_screenshot

# List open tabs
floyd_tabs
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+Y` | Open/close Floyd's TTY side panel |
| `Cmd+Shift+L` | Capture page context for agent |
| `Cmd+Shift+E` | Toggle Tom's vision overlay |

### Side Panel Controls

| Button | Function |
|--------|----------|
| **T1** / **T2** / **SPLIT** | Switch between terminal sessions |
| **ANALYZE** | Full page analysis (landmarks, headings, forms, etc.) |
| **DOM** | DOM structure dump |
| **A11Y** | WCAG accessibility audit |
| **CAP** | Screenshot capture |
| **LIVE** | Start/stop Gemini Live voice session |
| **SCR** | Share screen with Gemini Live |
| **CAM** | Share camera with Gemini Live |
| **SET** | API key & voice settings |
| **RE** | Reconnect native host |
| **RLD** | Reload entire extension |

---

## LLM Agent Onboarding

### Quick Start Prompt

Copy this entire section into your LLM agent's system prompt or first message:

````markdown
## Browser Control via Floyd TTY Bridge

You have direct control of a Chrome browser. At the start of your session, run:

```bash
source /usr/local/share/floyd/floyd-tools.sh
```

### Available Commands

| Command | Description | Example |
|---------|-------------|---------|
| `floyd_analyze_page` | Full page audit: DOM, a11y, forms, links | `floyd_analyze_page` |
| `floyd_dom` | DOM structure only (lighter) | `floyd_dom` |
| `floyd_navigate "URL"` | Navigate to URL | `floyd_navigate "https://google.com"` |
| `floyd_click "selector"` | Click element by CSS selector | `floyd_click "#submit-btn"` |
| `floyd_type "selector" "text"` | Type text into input | `floyd_type "#search" "hello"` |
| `floyd_fill_form '{"#a":"x"}'` | Fill multiple form fields | `floyd_fill_form '{"#name":"John","#email":"j@e.com"}'` |
| `floyd_select "selector" "value"` | Select dropdown option | `floyd_select "#country" "US"` |
| `floyd_scroll "target"` | Scroll to top/bottom/element | `floyd_scroll "bottom"` |
| `floyd_wait "selector" 5000` | Wait for element (ms) | `floyd_wait "#result" 10000` |
| `floyd_screenshot` | Capture visible tab as PNG | `floyd_screenshot` |
| `floyd_tabs` | List all open tabs | `floyd_tabs` |
| `floyd_open_tab "URL"` | Open new tab | `floyd_open_tab "https://github.com"` |
| `floyd_close_tab ID` | Close tab by ID | `floyd_close_tab 42` |
| `floyd_switch_tab ID` | Switch to tab by ID | `floyd_switch_tab 42` |
| `floyd_find "query"` | Find elements by text | `floyd_find "Sign In"` |
| `floyd_extract_text "selector"` | Get text content | `floyd_extract_text "article"` |
| `floyd_a11y "AA"` | WCAG accessibility audit | `floyd_a11y` |
| `floyd_contrast "selector"` | Check color contrast | `floyd_contrast "body"` |
| `floyd_ui_audit` | Visual sanity check | `floyd_ui_audit` |
| `floyd_page_state` | URL, title, scroll position | `floyd_page_state` |
| `floyd_refresh` | Reload active browser tab | `floyd_refresh` |
| `floyd_reload` | Reload the Floyd extension | `floyd_reload` |
| `floyd_ask_tom "question"` | Ask vision AI what it sees | `floyd_ask_tom "What's on the page?"` |

### Response Format

All commands return JSON. Always check for `ok: true` or `success: true` before proceeding.

**Success:**
```json
{"ok": true, "result": {...}}
```

**Error:**
```json
{"ok": false, "error": "Element not found: #missing"}
```

### Workflow Pattern

1. **Always analyze first** — Run `floyd_analyze_page` to understand what's on the page
2. **Use specific selectors** — Prefer `#id` or unique classes over generic tags
3. **Wait for dynamic content** — Use `floyd_wait` before interacting with AJAX-loaded elements
4. **Verify actions** — After clicks/form fills, re-analyze or check the page state
5. **Handle errors gracefully** — If a selector fails, re-analyze and try an alternative

### Example: Fill and Submit a Form

```bash
# Step 1: Analyze the page
floyd_analyze_page

# Step 2: Fill the form
floyd_fill_form '{"#username":"testuser","#password":"secretpass"}'

# Step 3: Click submit
floyd_click "button[type='submit']"

# Step 4: Wait for result
floyd_wait ".success-message" 5000

# Step 5: Verify
floyd_page_state
```

### Proxy Mode (External Terminals)

If running from iTerm, Terminal.app, or any terminal outside the Floyd side panel:

```bash
# Source from the extension directory
source "/path/to/floyd-tty-bridge/extension/floyd-tools.sh"

# The SDK auto-detects proxy mode
floyd_status  # Shows "Mode: proxy"

# Commands work the same, but require the Floyd side panel to be open
floyd_analyze_page
```

### Important Rules

1. **Never assume success** — Always check the JSON response
2. **Selectors must be exact** — CSS is case-sensitive; `#MyBtn` ≠ `#mybtn`
3. **Wait for navigation** — After `floyd_navigate`, the page may need time to load
4. **Escape quotes in JSON** — Use single quotes for shell args: `'{"#a":"b"}'`
5. **Large responses go to temp files** — Check `file` field in response for huge payloads
````

### Agent Integration Patterns

#### Pattern 1: Autonomous Web Navigation

```bash
# Agent can navigate, fill forms, click buttons, extract data
source /usr/local/share/floyd/floyd-tools.sh

floyd_navigate "https://example.com/login"
floyd_wait "#username" 5000
floyd_fill_form '{"#username":"agent","#password":"token123"}'
floyd_click "button[type='submit']"
floyd_wait ".dashboard" 10000
floyd_extract_text ".dashboard"
```

#### Pattern 2: Accessibility Auditing

```bash
source /usr/local/share/floyd/floyd-tools.sh

# Get full accessibility report
floyd_a11y "AA"

# Check contrast on specific elements
floyd_contrast ".headline"
floyd_contrast "nav a"

# Get visual sanity check
floyd_ui_audit
```

#### Pattern 3: Multi-Tab Workflow

```bash
source /usr/local/share/floyd/floyd-tools.sh

# Open research tabs
floyd_open_tab "https://docs.python.org"
floyd_open_tab "https://stackoverflow.com"

# List all tabs
tabs=$(floyd_tabs)

# Switch between them
floyd_switch_tab 42
floyd_extract_text "body"

floyd_switch_tab 43
floyd_extract_text "body"
```

#### Pattern 4: Screenshot-Based Verification

```bash
source /usr/local/share/floyd/floyd-tools.sh

# Take a screenshot for visual inspection
result=$(floyd_screenshot)

# The result contains base64 PNG data
# Agents with vision can analyze this directly
```

---

## Architecture Overview

### Communication Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           BRIDGE MODE                                     │
│  (Inside Floyd TTY Side Panel — Fast OSC 7701/7702 escape sequences)     │
│                                                                           │
│  ┌─────────────┐      ┌──────────────┐      ┌─────────────────────────┐  │
│  │   zsh       │      │ native_host  │      │   Chrome Extension      │  │
│  │   (PTY)     │ ───► │ (Python)     │ ───► │   background.js         │  │
│  │             │ OSC  │              │ JSON │   (Service Worker)      │  │
│  │ floyd_click │ 7701 │  Parser      │ 4B   │                         │  │
│  │   ...       │      │              │ len  │   Routes to:            │  │
│  └─────────────┘      └──────────────┘      │   • Content Script      │  │
│         ▲                                    │   • Chrome APIs         │  │
│         │                                    │   • Side Panel          │  │
│  ┌──────┴───────┐                            └─────────────────────────┘  │
│  │floyd-tools.sh│                                       │                │
│  │ (convenience │ ◄─────────────────────────────────────┘                │
│  │  wrappers)   │      OSC 7702 (JSON response)                          │
│  └──────────────┘                                                         │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                           PROXY MODE                                      │
│  (Any external terminal — File-based IPC via ~/floyd_comm/)              │
│                                                                           │
│  ┌─────────────┐      ┌──────────────┐      ┌─────────────────────────┐  │
│  │   iTerm     │      │ ~/floyd_comm │      │   Floyd Side Panel      │  │
│  │   Terminal  │ ───► │   cmd.json   │ ───► │   (polls every 500ms)   │  │
│  │   .app      │      │              │      │                         │  │
│  │             │      │   resp.json  │ ◄─── │   Executes tool, writes │  │
│  │ floyd_click │      │ ◄────────────│      │   response back         │  │
│  └─────────────┘      └──────────────┘      └─────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Dual Terminal Sessions

The side panel supports **two independent terminal sessions**:

| Session | Purpose | Native Host |
|---------|---------|-------------|
| **T1** | Primary LLM agent, Gemini Live (Tom) | Session 1 |
| **T2** | Secondary agent, vision tools, debugging | Session 2 |
| **SPLIT** | Both visible with draggable divider | Both |

### Key Files

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome extension manifest (MV3) |
| `background.js` | Service worker — routes messages, manages native hosts |
| `native_host.py` | Python native messaging host — PTY + OSC parser |
| `floyd-tools.sh` | Bash/Zsh SDK — convenience functions for agents |
| `sidepanel.js` | Side panel UI — xterm.js terminals, tool buttons |
| `content-script.js` | Injected into pages — DOM analysis, accessibility |
| `live-service.js` | Gemini Live API — audio/video streaming |

---

## Tool Reference

### Page Analysis

| Tool | Bash Function | Description |
|------|---------------|-------------|
| `analyze_page` | `floyd_analyze_page` | Full audit: DOM, landmarks, forms, links, images, a11y, CSS, score |
| `analyze_element` | `floyd_element "selector"` | Deep analysis of single element |
| `get_page_state` | `floyd_page_state` | URL, title, viewport, scroll position |
| `find_elements` | `floyd_find "query"` | Find elements by text content |
| `extract_text` | `floyd_extract_text "selector"` | Get text content from element |
| `extract_css` | `floyd_extract_css "selector"` | Get computed styles |

### Accessibility

| Tool | Bash Function | Description |
|------|---------------|-------------|
| `check_accessibility` | `floyd_a11y "AA"` | WCAG AA/AAA violation scan |
| `check_contrast` | `floyd_contrast "selector"` | Color contrast ratio analysis |

### Interaction

| Tool | Bash Function | Description |
|------|---------------|-------------|
| `click_element` | `floyd_click "selector"` | Click element by CSS selector |
| `type_text` | `floyd_type "selector" "text"` | Type into input field |
| `fill_form` | `floyd_fill_form '{"#a":"x"}'` | Batch fill multiple fields |
| `select_option` | `floyd_select "sel" "val"` | Select dropdown option |
| `scroll_to` | `floyd_scroll "target"` | Scroll to top/bottom/element |
| `navigate_to` | `floyd_navigate "URL"` | Navigate to URL |
| `wait_for_element` | `floyd_wait "sel" 5000` | Wait for element to appear |

### Tabs

| Tool | Bash Function | Description |
|------|---------------|-------------|
| `list_tabs` | `floyd_tabs` | List all open tabs |
| `open_tab` | `floyd_open_tab "URL"` | Open new tab |
| `close_tab` | `floyd_close_tab ID` | Close tab by ID |
| `switch_tab` | `floyd_switch_tab ID` | Switch to tab by ID |

### Capture

| Tool | Bash Function | Description |
|------|---------------|-------------|
| `take_screenshot` | `floyd_screenshot` | Capture visible tab as PNG |

### Advanced

| Tool | Bash Function | Description |
|------|---------------|-------------|
| `execute_local_shell` | `floyd_call execute_shell '{"command":"ls"}'` | Run shell command with output |
| `debug_command` | — | Raw Chrome DevTools Protocol command |
| `checkpoint_save` | — | Save session state for crash recovery |
| `checkpoint_restore` | — | Restore from checkpoint |
| `record_start/stop/export` | — | Record browser actions |
| `gif_start/add_frame/stop` | — | Create GIF recordings |

### Vision AI (Tom)

| Tool | Bash Function | Description |
|------|---------------|-------------|
| `ask_tom` | `floyd_ask_tom "What do you see?"` | Ask vision AI about current page |

---

## Troubleshooting

### Native Host Not Connecting

**Symptoms:** Red status dot, "DISCONNECTED" message, commands timeout.

**Solutions:**
1. Check extension ID matches manifest:
   ```bash
   cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.floyd.tty.json
   ```
2. Verify native host is executable:
   ```bash
   ls -la /usr/local/bin/floyd_tty_host.py
   # Should show -rwxr-xr-x
   ```
3. Test native host directly:
   ```bash
   echo '{"type":"ping"}' | python3 /usr/local/bin/floyd_tty_host.py
   # Should output: {"type": "ready", ...}
   ```
4. Re-run installer with correct extension ID.

### Extension Context Invalidated

**Symptoms:** "Extension context invalidated" errors after extension update.

**Solution:** Click **RLD** button in side panel, or run:
```bash
floyd_reload
```

### Proxy Mode Timeout

**Symptoms:** External terminal commands return timeout error.

**Solution:** Ensure Floyd's side panel is open in Chrome. Proxy mode requires an active side panel to poll `~/floyd_comm/`.

### Terminal Output Garbled

**Symptoms:** Characters overlapping, wrong colors, cursor in wrong position.

**Solutions:**
1. Click **RE** button to reconnect native host
2. Resize the side panel to trigger a refit
3. Check `TERM` environment variable:
   ```bash
   echo $TERM  # Should be xterm-256color
   ```

### Content Script Not Loading

**Symptoms:** "Cannot inject into this page" errors on special pages.

**Explanation:** Content scripts cannot run on:
- `chrome://` URLs
- `chrome-extension://` URLs
- Chrome Web Store
- Other extensions' pages

**Solution:** Navigate to a regular web page first.

### Zombie Processes

**Symptoms:** Old `native_host.py` processes consuming resources.

**Solution:**
```bash
# Find and kill zombie hosts
ps aux | grep floyd_tty_host
kill -9 <pid>

# Or kill all
pkill -f floyd_tty_host
```

---

## Support

- **Issues:** [GitHub Issues](https://github.com/your-repo/floyd-tty-bridge/issues)
- **Security:** See `SECURITY.md` for vulnerability reporting
- **Privacy:** See `PRIVACY.md` for data handling details

---

*Floyd's Labs TTY Bridge v5.1.0 — MIT License*
