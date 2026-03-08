# Underneath The Bridge

A technical capabilities report on the Floyd TTY Bridge for Chrome.

---

## I. What It Is

The Floyd TTY Bridge is a Chrome Extension (Manifest V3) that creates a bidirectional communication channel between a Unix PTY shell and Chrome's browser engine. It uses Chrome's Native Messaging protocol on one side and OSC (Operating System Command) terminal escape sequences on the other. Any process running inside the PTY — a bash script, a Python agent, a Node CLI, an LLM — can issue structured JSON commands via OSC 7701 sequences and receive structured JSON responses via OSC 7702. Those commands are routed through Chrome's service worker to a content script running inside the active web page, where a 1,300-line DOM analysis engine executes them against the live document.

In practical terms: it turns Chrome into a scriptable tool that any terminal process can operate through the same interface it already uses — text.

## II. How It Functions

### The Wire

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
```

**native_host.py** — Spawned by Chrome as a native messaging host. Opens a PTY, forks a login shell into it. Runs three threads: a PTY reader (scans output for OSC 7701, forwards passthrough text), a Chrome reader (reads length-prefixed JSON from stdin, dispatches to the PTY), and a watchdog (reaps zombie processes). The OSC parser handles partial reads, both BEL and ST terminators, and caps buffered body at 256KB. Messages over 1MB spill to secure temp files. All stdout writes go through a threading lock.

**background.js** — MV3 service worker. Connects to the native host via `chrome.runtime.connectNative`. Routes tool calls from the native host to the content script in the active tab. Handles browser-level APIs directly (tab management, screenshots, shell execution). Manages reconnection with exponential backoff. Keeps the service worker alive via a 24-second alarm ping cycle. Sanitizes all page-derived data before it touches the native messaging channel.

**content-script.js** — Injected into every page at `document_idle`. Implements 24 tool endpoints: full page analysis, DOM traversal, accessibility auditing (WCAG AA/AAA), CSS extraction (flex/grid counts, custom properties, animations, media queries), contrast ratio checking with alpha compositing through the DOM tree, element interaction (click, type, fill form, select option), navigation, scrolling, waiting, text extraction, and a vision overlay that renders interactive element bounding boxes with their CSS selectors.

**interceptors-main.js** — Injected into the page's main world (not the isolated content script world). Monkey-patches `console.error`, `window.fetch`, `XMLHttpRequest.prototype.open/send`, `window.onerror`, and `window.onunhandledrejection`. Filters out noisy telemetry endpoints. Reports through `window.postMessage` back to the content script, which routes through background.js as sanitized structured events.

**sidepanel.js** — An xterm.js terminal rendered in Chrome's side panel. Displays PTY output in real-time. Provides UI buttons for one-click page analysis, DOM inspection, accessibility audit, and screenshots. Supports Gemini Live sessions with microphone, screen share, and camera input routed through an AudioWorklet pipeline.

**live-service.js** — Full Gemini Live API integration. Bidirectional audio streaming with echo cancellation. Video frame capture at 3 FPS from screen share or camera. Handles tool calls from Gemini (the model can invoke browser tools mid-conversation). Automatic reconnection with state preservation.

**floyd-tools.sh** — Bash SDK. Source it in any shell running inside the bridge. Provides 24 convenience functions (`floyd_click`, `floyd_type`, `floyd_navigate`, `floyd_analyze_page`, etc.) and a raw `floyd_call` function. Handles OSC 7701 emission, OSC 7702 parsing (character-by-character with timeout), and large-payload file dereferencing. Works in both bash and zsh.

### The Tool Surface

| Tool | What It Does |
|------|-------------|
| `analyze_page` | Full page audit: landmarks, headings, images, links, forms, interactive elements, CSS snapshot, accessibility, contrast, technical issues, quality score |
| `check_accessibility` | WCAG AA/AAA violation scan with severity, rule, element selector, and fix suggestion |
| `check_contrast` | Luminance-based contrast ratio calculation with alpha compositing through parent chain |
| `extract_css` | Computed style extraction for any selector |
| `extract_text` | Text content extraction from any element subtree |
| `get_page_state` | URL, title, viewport, scroll position, document dimensions |
| `click_element` | Click any element by CSS selector with pre/post DOM snapshot diffing |
| `type_text` | Type into inputs with focus, value setting, and input/change event dispatch |
| `fill_form` | Batch fill multiple form fields from a JSON map |
| `select_option` | Select dropdown options by value |
| `scroll_to` | Scroll to top, bottom, element, or arbitrary coordinates |
| `navigate_to` | Page navigation |
| `wait_for_element` | Poll for element existence with configurable timeout |
| `analyze_element` | Deep single-element analysis: computed styles, accessibility tree, bounding rect |
| `find_elements` | Query selector with visibility/rect/text extraction for each match |
| `take_screenshot` | Capture visible tab as PNG data URL |
| `open_tab` / `close_tab` / `switch_tab` / `list_tabs` / `get_tab_state` | Full tab management |
| `write_observation` / `read_commands` | Agent scratchpad for persisting observations and reading queued instructions |
| `query_knowledge` | Vector search against a 12,000+ document knowledge base |
| `execute_local_shell` | Run arbitrary shell commands outside the PTY with stdout/stderr/exitCode capture |

### Passive Capabilities (Always Running)

- **DOM Mutation Streaming** — MutationObserver on `document.body` watches `childList`, `subtree`, and attribute changes (`class`, `id`, `style`). Debounced at 1 second, with immediate flush if 3+ seconds have elapsed. Reports DOM snapshots as system events.
- **Console Error Interception** — Every `console.error` on every page is captured and forwarded.
- **Network Failure Monitoring** — Every failed `fetch()` and `XMLHttpRequest` (status ≥ 400 or network error) is captured. Noisy telemetry endpoints are filtered.
- **Unhandled Exception Capture** — Both synchronous errors and unhandled promise rejections are forwarded with source location.
- **Vision Overlay** — Keyboard shortcut toggles a visual overlay showing bounding boxes and CSS selectors for all interactive elements on the page.

---

## III. Current Use Cases

1. **LLM-Driven Browser Automation** — An AI agent running in the terminal can navigate web pages, fill forms, click buttons, extract content, and take screenshots through natural tool calls. No Puppeteer, no WebDriver, no separate browser process. The agent uses the same Chrome instance the human uses.

2. **Accessibility Compliance Auditing** — Full WCAG AA/AAA scans with contrast ratio calculation, missing alt text detection, missing form labels, heading hierarchy validation, and landmark structure analysis. Returns a quality score out of 100.

3. **Real-Time Page Debugging** — Console errors, network failures, unhandled exceptions, and DOM mutations stream to the terminal as they happen. An agent can watch a page react to its own interactions.

4. **Visual QA / Design Review** — Screenshots plus CSS extraction (flex/grid layout, custom properties, animations, media queries) give an agent enough information to evaluate visual implementation against design intent.

5. **Multimodal AI Sessions** — Gemini Live integration enables voice conversation with an AI that can see the screen (3 FPS video) and execute browser tools. A human speaks; the AI sees, reasons, and acts.

6. **Knowledge-Augmented Browsing** — The `query_knowledge` tool connects to a vectorized document store, letting agents retrieve contextual information while operating the browser.

---

## IV. Sub-Surface Use Cases You've Overlooked

### 1. Continuous Integration Web Verification

The bridge runs in a real Chrome instance with real rendering. A CI pipeline could spawn Chrome with the extension loaded, run a sequence of `floyd_call` commands, and verify that a deployed web application renders correctly, passes accessibility checks, and has no console errors — all from a bash script. Unlike headless Puppeteer, this tests the actual browser environment users experience, including extensions, service workers, and CSS rendering differences.

### 2. Competitive Intelligence Gathering

`analyze_page` extracts the full structural fingerprint of any website: landmark architecture, heading hierarchy, CSS layout strategy (flex vs grid ratios), custom property naming conventions, animation names, and media query breakpoints. Run this against a competitor's site weekly and diff the results. You get a machine-readable changelog of their frontend evolution without touching their source code.

### 3. Form-Heavy Workflow Automation

Government portals, insurance forms, HR onboarding systems, expense reports — these are web applications that deliberately don't have APIs. The combination of `fill_form`, `click_element`, `wait_for_element`, and `select_option` means an agent can operate any web form that a human can. The DOM snapshot diffing after each click provides the feedback loop to know what happened.

### 4. Regression Detection Pipeline

Run `analyze_page` before and after a deployment. Diff the outputs. Changes in heading count, landmark structure, interactive element count, contrast ratios, or quality score indicate regressions. The DOM mutation stream during navigation catches client-side rendering issues that server-side tests miss entirely.

### 5. Multi-Tab Workflow Orchestration

An agent can `open_tab`, `switch_tab`, `extract_text` from one tab, `switch_tab` to another, and `type_text` with the extracted content. This enables cross-application workflows: copy data from a CRM into a spreadsheet, pull a ticket number from Jira and paste it into a Slack message, or aggregate information from multiple dashboards into a single report.

### 6. Automated Content Moderation

Inject into user-generated content pages. Use `extract_text` and `find_elements` to pull content, then feed it through the knowledge base or an LLM for policy evaluation. The interceptors catch any dynamic content loading. Flag violations in real-time as content loads.

### 7. Browser-as-Sensor for Infrastructure Monitoring

If your infrastructure has web dashboards (Grafana, Datadog, AWS Console), an agent can navigate to them, extract metric values via `extract_text`, take screenshots for archival, and trigger alerts — all from a cron job in the terminal. No API integration needed. If a human can see it in Chrome, the agent can read it.

### 8. Interactive Tutorial and Walkthrough Generation

The vision overlay shows exactly which elements an agent can see and interact with. Combined with `analyze_page` and `get_page_state`, an agent can generate step-by-step tutorials for any web application: "Click the button labeled X at position (340, 220), then fill the form field labeled Y with Z." The CSS selectors in the overlay output make these instructions reproducible.

---

## V. Three Deep Sub-Surface Use Cases

### Deep Use Case 1: The Browser as a Universal Authentication Proxy

Most APIs require authentication. OAuth flows, SSO redirects, SAML assertions, MFA challenges, CAPTCHA gates — these all happen in the browser. The Floyd Bridge doesn't just automate web pages; it automates web *sessions*, including their authentication state.

An agent can `navigate_to` a login page, `fill_form` with credentials, `click_element` on the submit button, `wait_for_element` for the authenticated state, and then operate freely within the authenticated session. Chrome manages cookies, session storage, and CORS automatically. The interceptors report if any API call fails with a 401.

This turns Chrome into a universal API client for services that deliberately don't offer APIs. Legacy enterprise applications, government systems with complex login flows, banking portals with hardware token MFA (where the human handles the token but the agent handles everything else), internal tools behind corporate SSO — the agent operates through the same door the human walks through.

The implication scales further. Because Chrome handles certificate management, proxy configuration, and corporate VPN split tunneling, the bridge inherits all of this infrastructure automatically. An agent doesn't need to be configured for your network topology. It just uses the browser that already is.

**What this enables that nothing else can:** An agent that operates a web application requiring smart-card authentication, hardware MFA, and corporate SSO — things that no API wrapper, no Puppeteer script, and no RPA tool can handle — because the human provides the authentication factor and the agent provides the labor.

### Deep Use Case 2: Behavioral Reverse Engineering via Temporal State Machines

The bridge doesn't just observe a web page at a point in time. It observes a web page *across time*, with causal precision.

Every `click_element` call captures a DOM snapshot before and after, then diffs them. The MutationObserver streams structural changes continuously. The network interceptors report every API call the page makes in response to user action. The `get_page_state` tool captures scroll position, URL changes, and viewport state.

Feed this data stream into a state machine learner, and you get something unprecedented: a complete behavioral model of a web application, reverse-engineered from the outside, without access to source code.

Consider: an agent systematically explores a SaaS application. It clicks every button, fills every form, navigates every link. For each action, it records: (1) what the DOM looked like before, (2) what it clicked, (3) what API calls the page made, (4) what the DOM looked like after, (5) what the URL became. After exhaustive exploration, you have a formal state transition graph of the entire application.

This has three profound applications:

- **Competitive analysis**: Reconstruct the complete feature set and UX flow of a competitor's product without screenshots or manual documentation. The output is a machine-readable specification, not a slide deck.
- **Migration planning**: Before rewriting a legacy web application, generate its behavioral specification automatically. Use it as the acceptance test suite for the new implementation. The old app becomes its own spec.
- **Security auditing**: Map every reachable state in a web application, including states the developers didn't intend to be reachable. The network interceptor reveals which API endpoints each state touches. Unreachable-but-requestable endpoints are potential attack surface.

**What this enables that nothing else can:** A behavioral specification of a web application that includes the server's API contract, derived purely from client-side observation — something that no static analysis tool, no API fuzzer, and no manual QA process can produce.

### Deep Use Case 3: Self-Referential Capability Bootstrapping

The bridge injects its content script into `<all_urls>`. Chrome's side panel is a web page. Chrome's own internal pages (`chrome://extensions`, `chrome://settings`) are web pages. The extension's own popup and options pages are web pages.

This creates a self-referential loop: the bridge can inspect, analyze, and interact with its own UI.

But the deeper realization is this: the bridge provides terminal access (via the PTY) AND browser access (via the content script) AND filesystem access (via `execute_local_shell`) AND live AI access (via Gemini Live). An agent operating through the bridge can:

1. Read the bridge's own source code (filesystem access via the shell)
2. Modify the bridge's own source code (filesystem writes via the shell)
3. Reload the extension (navigate to `chrome://extensions`, click reload)
4. Verify the changes worked (inspect the sidepanel DOM, run tool calls)
5. Roll back if they didn't (git revert via the shell)

This is a closed development loop. The tool can improve itself.

But it doesn't stop at self-modification. The pattern generalizes. Any Chrome extension, any web application, any CLI tool — the bridge can develop, test, and deploy software that targets the browser. An agent can:

- Write a userscript, inject it, and verify it works — all in one session
- Build a Chrome extension from scratch, load it unpacked, test it, iterate
- Develop a web component, serve it locally (`python -m http.server` via the shell), navigate to it, inspect the rendering, modify it, reload
- Write backend code, deploy it, navigate to the frontend that consumes it, and validate end-to-end

The bridge is not just a browser automation tool. It is a complete software development environment where the development target, the testing environment, the deployment platform, and the developer's workstation are all the same system — Chrome and the terminal underneath it.

**What this enables that nothing else can:** A fully autonomous development cycle where an AI agent writes code, deploys it, tests it in a real browser, observes real user-facing behavior, and iterates — without any human intervention between writing and validation. The bridge closes the loop that every other AI coding tool leaves open: the gap between "code generated" and "code verified in production conditions."

---

*Generated during v4.6 hardening review. March 2026.*
