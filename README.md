# Floyd's Labs TTY Bridge

**Version 5.1.0** — AI agent browser bridge for macOS

Connects LLM CLI tools to full browser control, page analysis, screen capture, and 12,000+ vectorized knowledge documents. Works inside the side panel terminal OR from any external terminal via file-based IPC.

## Quick Links

| Document | Purpose |
|----------|---------|
| **[ONBOARDING.md](ONBOARDING.md)** | Full onboarding guide for humans AND LLM agents |
| **[AGENT_QUICKREF.md](AGENT_QUICKREF.md)** | Quick reference card for LLM agents (copy-paste ready) |
| **[ADVANCED_FEATURES.md](ADVANCED_FEATURES.md)** | Hidden/latent capabilities, power user features |
| **[SECURITY.md](SECURITY.md)** | Security policy and permission justifications |
| **[PRIVACY.md](PRIVACY.md)** | Data handling details |

## Architecture

```
┌─────────────┐   OSC 7701/7702    ┌──────────────┐   Native Messaging    ┌──────────────┐
│  Agent/Shell │ ◄──────────────► │ native_host  │ ◄──────────────────► │ background   │
│  (PTY)       │   (escape seqs)   │ (Python)     │   (4-byte LE + JSON)  │ (SW, MV3)    │
└─────────────┘                    └──────────────┘                       └──────┬───────┘
                                                                                 │
                                                                     ┌───────────┼───────────┐
                                                                     │           │           │
                                                              ┌──────▼──┐  ┌─────▼────┐ ┌───▼────────┐
                                                              │ content  │  │ sidepanel │ │ offscreen  │
                                                              │ script   │  │ (xterm)   │ │ (audio)    │
                                                              └──────────┘  └──────────┘ └────────────┘

External terminals connect via file proxy:
┌─────────────┐   ~/floyd_comm/    ┌──────────────┐
│  External   │ ◄──────────────► │ sidepanel.js │ ── (same tool routing as above)
│  Terminal   │   cmd.json/resp    │ (poll 500ms) │
└─────────────┘                    └──────────────┘
```

### Dual Terminal Sessions

The side panel supports two independent terminal sessions (T1/T2), each with its own native host PTY. Both share access to the same browser tools on the active tab.

- **T1**: Primary terminal (LLM agent, Tom/Gemini Live)
- **T2**: Secondary terminal (vision tools, debugging, second agent)
- **SPLIT**: Both terminals visible with a draggable divider

## Prerequisites

- macOS
- Google Chrome 116+
- Python 3.8+

## Installation

1. Load the extension in Chrome:
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the `extension` directory in this project
   - Copy the generated **Extension ID**

2. Run the installation script:
   ```bash
   ./install.sh install <extension_id>
   ```

To uninstall:
```bash
./install.sh uninstall
```

## Quick Start

### Inside the Floyd Side Panel (Bridge Mode)

1. Open the Floyd TTY side panel in Chrome using `Cmd+Shift+Y`.
2. Inside the terminal, source the Bash SDK:
   ```bash
   source /usr/local/share/floyd/floyd-tools.sh
   ```
3. Run a test command:
   ```bash
   floyd_navigate "https://google.com"
   floyd_analyze_page
   ```

### From Any External Terminal (Proxy Mode)

1. Make sure the Floyd side panel is open in Chrome.
2. In iTerm, Terminal.app, VS Code terminal, or any other terminal:
   ```bash
   source "/Volumes/Storage/Floyd TTY Bridge for Chrome/extension/floyd-tools.sh"
   floyd_status          # shows "Proxy mode"
   floyd_analyze_page    # works — routed through ~/floyd_comm/
   floyd_click "#submit"
   ```

The script auto-detects the environment. When `FLOYD_TTY_BRIDGE` is set (inside the side panel PTY), it uses fast OSC escape sequences. Otherwise, it falls back to file-based IPC via `~/floyd_comm/`.

### Giving an LLM Agent Browser Control

Add this to any LLM agent's system prompt or startup instructions:

```
## Browser Control (Floyd TTY Bridge)

You can control the Chrome browser. Run this at the start of your session:

  source "/Volumes/Storage/Floyd TTY Bridge for Chrome/extension/floyd-tools.sh"

Then use these commands:
  floyd_analyze_page              — See all elements on the current page
  floyd_navigate "URL"            — Go to a website
  floyd_type "#selector" "text"   — Type into an input field
  floyd_fill_form '{"#a":"x"}'   — Fill multiple fields at once
  floyd_click ".selector"         — Click a button or link
  floyd_select "#dropdown" "val"  — Select a dropdown option
  floyd_screenshot                — Capture the visible page
  floyd_wait "#element" 5000      — Wait for element to appear
  floyd_tabs                      — List all open browser tabs

All commands return JSON. Check for errors before proceeding.
```

## Tool Reference

| Tool | Description |
|------|-------------|
| `analyze_page` | Full page audit: landmarks, headings, images, links, forms, interactive elements, CSS, accessibility, contrast, and quality score |
| `check_accessibility` | WCAG AA/AAA violation scan with severity, rules, and fix suggestions |
| `check_contrast` | Luminance-based contrast ratio calculation with alpha compositing |
| `extract_css` | Computed style extraction for any CSS selector |
| `extract_text` | Text content extraction from any element subtree |
| `get_page_state` | URL, title, viewport, scroll position, and document dimensions |
| `click_element` | Click element by CSS selector with pre/post DOM snapshot diffing |
| `type_text` | Type into inputs with focus and event dispatch |
| `fill_form` | Batch fill multiple form fields from a JSON map |
| `select_option` | Select dropdown options by value |
| `scroll_to` | Scroll to top, bottom, element, or arbitrary coordinates |
| `navigate_to` | Page navigation |
| `wait_for_element` | Poll for element existence with configurable timeout |
| `analyze_element` | Deep single-element analysis: computed styles, accessibility tree, bounding rect |
| `find_elements` | Query selector with visibility, rect, and text extraction for each match |
| `take_screenshot` | Capture visible tab as PNG data URL |
| `open_tab` | Open a new browser tab |
| `close_tab` | Close a specific tab by ID |
| `switch_tab` | Switch focus to a specific tab by ID |
| `list_tabs` | List all open tabs and their states |
| `get_tab_state` | Get state for a specific tab |
| `write_observation` | Persist agent observations to a scratchpad |
| `read_commands` | Read queued instructions from the agent scratchpad |
| `query_knowledge` | Vector search against a 12,000+ document knowledge base |
| `execute_local_shell` | Run arbitrary shell commands outside the PTY with output capture |
| `reload_extension` | Reload the entire Floyd extension |
| `read_page` | Full accessibility tree of the current page with element ref IDs |
| `read_console` | Read captured console.error/warn/log messages with filtering |
| `click_ref` | Click element by ref ID from accessibility tree (stable cross-call targeting) |
| `type_ref` | Type into element by ref ID |
| `scroll_to_ref` | Scroll to element by ref ID |
| `distill_dom` | Filtered DOM view: text_only, input_fields, or all_content (60-80% token reduction) |
| `get_dom_changes` | Structured deltas since last read (added, removed, changed elements) |
| `set_of_marks` | Inject numbered visual labels on page elements for screenshot-based grounding |
| `click_mark` | Click element by mark number from Set-of-Marks overlay |
| `quick` | Execute batch of single-letter commands (C/T/K/S/N/R/D/M/X/P/Q) sequentially |
| `read_network` | Captured network requests with URL pattern filtering via CDP |
| `start_network_monitor` | Start CDP-based network traffic capture on active tab |
| `stop_network_monitor` | Stop network traffic capture |
| `add_net_rule` | Add declarativeNetRequest rule (block, redirect, or modify headers) |
| `remove_net_rule` | Remove a dynamic network rule by ID |
| `download` | Download a file via chrome.downloads API |
| `download_status` | Check download progress by ID |
| `create_tab_group` | Group tabs with title, color, and collapse state |
| `manage_tab_group` | Collapse, expand, ungroup, or update a tab group |
| `debug_command` | Send raw Chrome DevTools Protocol command via chrome.debugger |
| `checkpoint_save` | Save agent session state (URL, scroll, refs, tab group) for crash resilience |
| `checkpoint_restore` | Restore session from checkpoint |
| `record_start` | Start recording user/agent actions on active tab |
| `record_stop` | Stop action recording |
| `record_export` | Export recorded actions as JSON or natural language prompt |
| `gif_start` | Start GIF recording session |
| `gif_add_frame` | Add frame with action overlay to GIF recording |
| `gif_stop` | Finalize and export GIF recording |
| `audit_ui` | Deterministic visual sanity check: contrast ratios, layout centering, overflow, and content presence |
| `wasm_exec` | Execute WASM module in offscreen document (SHA-256 hash PoC) |

## Bash SDK

The SDK provides convenience functions for all tools. Works in both bridge mode (inside side panel) and proxy mode (external terminal).

```bash
# Raw tool call
result=$(floyd_call extract_text '{"selector":"main"}')

# Convenience functions
floyd_click ".btn-submit"
floyd_type "#search" "query"
floyd_fill_form '{"#name":"John","#email":"john@example.com"}'
floyd_ui_audit
floyd_screenshot
floyd_reload                    # Reload the extension
floyd_query "How do I file a tax extension?"
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+Y` | Open Floyd's TTY Side Panel |
| `Cmd+Shift+L` | Capture page context for agent |
| `Cmd+Shift+E` | Toggle Tom's vision overlay |

## Side Panel Controls

| Button | Action |
|--------|--------|
| T1 / T2 / SPLIT | Switch terminal view |
| ANALYZE | Full page analysis |
| DOM | DOM structure dump |
| A11Y | Accessibility audit |
| CAP | Screenshot capture |
| LIVE | Start/stop Gemini Live |
| SCR | Screen share to Gemini |
| CAM | Camera share to Gemini |
| SET | API key & voice settings |
| RE | Reconnect native host |
| RLD | Reload entire extension |

## Gemini Live Integration

The bridge includes full Gemini Live API integration for bidirectional audio and video AI sessions.

- **Audio**: Real-time streaming with echo cancellation via AudioWorklet pipeline.
- **Video**: Frame capture at 3 FPS from screen share or camera.
- **Tool Use**: The model can invoke browser tools mid-conversation to interact with the page.

## AI Engineering Standards (The "No Focus Break" Rule)

This project enforces a strict feedback loop for AI agents to prevent broken or invisible UI from being delivered to users.

1.  **Visual Proof**: Agents MUST NOT report a task as "complete" until they have run `floyd_ui_audit` and received a passing score.
2.  **Contrast Minimums**: Any text element with a contrast ratio < 3.0:1 is considered a build failure.
3.  **Layout Centering**: Layouts squashed into one-third of the screen MUST be corrected before delivery.
4.  **Deterministic Logic**: Use `audit_ui` (math-based) rather than visual descriptions when verifying UI stability.

## Troubleshooting

- **Native host not connecting**: Ensure the extension ID in `com.floyd.tty.json` matches the ID in `chrome://extensions`. Check that `native_host.py` is executable.
- **Extension context invalidated**: Happens after an extension update. Click RLD or run `floyd_reload`.
- **Proxy mode timeout**: Make sure the Floyd side panel is open in Chrome. The file proxy only runs when the panel is active.
- **Terminal mangling**: The side panel uses `@xterm/addon-fit` for accurate sizing. If output still looks wrong, try clicking RE to reconnect, or resize the panel.
- **PTY errors**: Ensure you are on macOS. Check for zombie `native_host.py` processes if the terminal hangs.

## Development

### Project Structure
- `extension/`: Chrome extension source (Manifest V3)
- `extension/native_host.py`: Python native messaging host
- `extension/floyd-tools.sh`: Bash/Zsh SDK (bridge + proxy modes)
- `install.sh`: macOS installation script
- `tests/`: Python integration tests
- `extension/test/`: Vitest smoke tests

### Testing

```bash
# Python tests (native host, e2e bridge)
pytest tests/ -v

# Extension tests
cd extension && npx vitest run

# Browser test harness (manual)
# tests/test-content-tools.html
```

### CI

GitHub Actions runs both test suites on every push to `main` and `bleeding-edge-upgrade`, and on all PRs. See `.github/workflows/ci.yml`.

## Security

See [SECURITY.md](SECURITY.md) for the full security policy, permission justifications, and architecture trust boundaries.

## Privacy

See [PRIVACY.md](PRIVACY.md) for data handling details. **TL;DR**: Everything stays local. The only external connection is to Google's Gemini API if you configure a key and start a Live session.

## License

[MIT](LICENSE)
