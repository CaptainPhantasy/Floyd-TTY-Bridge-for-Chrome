# Changelog

All notable changes to the Floyd TTY Bridge for Chrome are documented here.

## [5.0.0] - 2026-03-10

### Added
- **Tom the Peep vision engine** — full browser verification loop with screenshot analysis, DOM diffing, and agent-guided iteration
- **Set-of-Marks overlay** (`set-of-marks.js`) — inject numbered visual labels on page elements for screenshot-based grounding
- **Quick mode** (`quick-mode.js`) — batch single-letter commands (C/T/K/S/N/R/D/M/X/P/Q) for rapid agent workflows
- **GIF recorder** (`gif-recorder.js`) — capture multi-frame recordings with action overlays for agent session playback
- **Workflow recorder** (`workflow-recorder.js`) — record and export user/agent actions as JSON or natural language prompts
- **DOM observer** (`dom-observer.js`) — structured DOM mutation tracking with delta reporting between reads
- **Network monitor** (`network-monitor.js`) — CDP-based network traffic capture with URL pattern filtering
- **Network rules** (`net-rules.js`) — declarativeNetRequest rule management (block, redirect, modify headers)
- **MCP server** (`mcp-server.js`) — Model Context Protocol integration for tool discovery and invocation
- **Checkpoint system** (`checkpoint.js`) — save and restore agent session state for crash resilience
- **Distill DOM** (`distill-dom.js`) — filtered DOM views with 60-80% token reduction (text_only, input_fields, all_content)
- **Ref-based targeting** (`ref-tools.js`) — stable cross-call element targeting via accessibility tree ref IDs
- **Agent indicator** (`agent-indicator.js`) — visual feedback overlay when agent is actively controlling the page
- **CDP wrapper** (`cdp.js`) — Chrome DevTools Protocol abstraction for debugger-based operations
- **Lab bridge** (`lab_bridge.js`) — internal lab integration utilities
- **Gemini Live bidirectional audio/video** — real-time streaming with echo cancellation, 3 FPS screen capture, and mid-conversation tool use
- **Adaptive video streaming** — dynamic frame rate and resolution based on connection quality
- **Console capture** — read captured console.error/warn/log messages with severity filtering
- **Download management** — file download via chrome.downloads API with progress tracking
- **Tab group management** — create, collapse, expand, and update tab groups with titles and colors
- **Raw CDP command access** — send arbitrary Chrome DevTools Protocol commands via chrome.debugger
- **WASM execution** — WebAssembly module execution in offscreen document (SHA-256 hash PoC)
- **23 smoke test files** covering all extension modules via vitest
- **End-to-end bridge tests** (`tests/test_e2e_bridge.py`) for native messaging round-trip validation
- **Live demo harness** (`tests/demo_bridge_live.sh`) for real-bridge verification
- **MIT License**, **SECURITY.md**, **PRIVACY.md**
- **GitHub Actions CI** for automated testing on push and PR
- Hardened `.gitignore` with secret-blocking patterns to prevent API key commits

### Fixed
- **Native host shutdown crash** — `SIGABRT` in `_Py_Finalize` caused by buffered IO race between `chrome_reader` thread and Python module cleanup. Fixed by closing stdin to unblock the reader, flushing stdout, and using `os._exit()` to skip finalization.

### Changed
- Version bump to 5.0.0 across all files (manifest.json, package.json, native_host.py, floyd-tools.sh, sidepanel.html, install.sh)
- Installer permissions tightened: native host 700, SDK 600 (was 755/644)
- Content Security Policy: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`

### Security
- Hardened `.gitignore` to block `*api_key*`, `*secret*`, `*credential*`, `*token*` patterns
- Permission justification documented in SECURITY.md
- Native host process isolation via `os.setsid` process groups

## [4.6.0] - 2026-03-08

### Added
- **Input validation** for all 24 content-script tool handlers with structured error responses (`{ error: 'Missing required parameter: <name>' }`)
- Shared validation helpers: `getNonEmptyStringArg`, `hasNumericArg`, `hasArrayArg`, `isValidNavigationUrl`
- Caps on resource-intensive parameters: `find_elements` and `extract_text` limit capped at 100, `wait_for_element` timeout capped at 30,000ms
- URL format validation for `navigate_to` and `open_tab` (must start with `http://`, `https://`, or `chrome://`)
- **pytest test suite** for `native_host.py` — 36 test cases covering OSCParser, message framing, chrome_to_pty, ProcessSupervisor, and cleanup
- **Browser test harness** (`tests/test-content-tools.html`) — standalone HTML page with 20+ assertions validating all content-script tool endpoints against a known DOM
- **Installer** (`install.sh`) — automated setup for native host binary, Bash SDK, and Chrome native messaging manifest registration with auto-detection of extension ID
- `.gitignore` with standard exclusions (`.DS_Store`, `__pycache__`, `*.pyc`, `*.zip`, `.env`)
- Configurable knowledge base URL via `chrome.storage.local['knowledge_base_url']` (was hardcoded IP)

### Fixed
- **Version inconsistency** — aligned all files to v4.6.0 (manifest.json, sidepanel.js, sidepanel.html, native_host.py, background.js, floyd-tools.sh)
- **floyd-tools.sh version guard** — changed from exact version match (`!= "4.0"`) to presence check (`-z "$FLOYD_TTY_BRIDGE"`)
- **floyd_find() SDK bug** — was passing `{"selector":"$selector"}` but `find_elements` expects `{"query":"..."}` parameter name
- **Sidepanel landmarks display** — `r.landmarks?.length` failed because landmarks is an object, not an array; fixed to `Object.keys(r.landmarks || {}).length`
- **URL validation error messages** — `navigate_to` and `open_tab` now include the actual invalid URL in the error message instead of the literal string `'url'`

### Removed
- Dead `TARGET_KEY` variable and associated `chrome.storage.local.get/set` logic from `background.js`
- Hardcoded knowledge base IP from `content-script.js`

### Changed
- `extension/com.floyd.tty.json` native messaging manifest path updated to `/usr/local/bin/floyd-tty-bridge/native_host.py`
- `extension/package.json` updated with proper name (`floyd-tty-bridge`), version, description, and keywords

## [4.5.0] - 2026-03

### Added
- Enterprise hardening: thread safety for stdout writes, type safety for IPC messages
- Extension context invalidation error suppression in content script
- Sidepanel UI hardening with output chunking and robust xterm.js options checks
- IPC messaging hardening for observers

### Security
- Removed hardcoded API key from background script

---

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
