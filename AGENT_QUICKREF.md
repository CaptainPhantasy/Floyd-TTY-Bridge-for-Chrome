# Floyd TTY Bridge — Agent Quick Reference Card

**Copy this entire file into your LLM agent's system prompt.**

---

## Initialization (REQUIRED)

```bash
source /usr/local/share/floyd/floyd-tools.sh
```

---

## Core Commands

### Page Analysis

| Command | Returns |
|---------|---------|
| `floyd_analyze_page` | Full page audit (DOM, forms, links, a11y, score) |
| `floyd_dom` | DOM structure only (lighter) |
| `floyd_page_state` | URL, title, scroll position |
| `floyd_find "text"` | Elements matching text |
| `floyd_extract_text "selector"` | Text content from element |

### Navigation

| Command | Action |
|---------|--------|
| `floyd_navigate "URL"` | Go to URL |
| `floyd_refresh` | Reload current page |
| `floyd_tabs` | List all open tabs |
| `floyd_open_tab "URL"` | Open new tab |
| `floyd_switch_tab ID` | Switch to tab |
| `floyd_close_tab ID` | Close tab |

### Interaction

| Command | Action |
|---------|--------|
| `floyd_click "selector"` | Click element |
| `floyd_type "selector" "text"` | Type into input |
| `floyd_fill_form '{"#a":"x","#b":"y"}'` | Fill multiple fields |
| `floyd_select "selector" "value"` | Select dropdown option |
| `floyd_scroll "bottom"` | Scroll page |
| `floyd_wait "selector" 5000` | Wait for element (ms) |

### Capture & Audit

| Command | Action |
|---------|--------|
| `floyd_screenshot` | Capture visible tab (PNG base64) |
| `floyd_a11y` | WCAG accessibility audit |
| `floyd_contrast "selector"` | Color contrast check |
| `floyd_ui_audit` | Visual sanity check |

### Vision AI (Tom)

| Command | Action |
|---------|--------|
| `floyd_ask_tom "What's on the page?"` | Ask AI to describe page |

---

## Response Format

All commands return JSON:

```json
// Success
{"ok": true, "result": {...}}

// Error
{"ok": false, "error": "Element not found"}
```

**Always check `ok` or `success` before proceeding.**

---

## Workflow Pattern

```bash
# 1. ANALYZE
floyd_analyze_page

# 2. INTERACT
floyd_click "#submit"
floyd_type "#search" "query"

# 3. WAIT
floyd_wait ".result" 5000

# 4. VERIFY
floyd_page_state
floyd_extract_text ".result"
```

---

## Selector Tips

- Prefer `#id` (fastest, unique)
- Use `"tag.class"` for class-based selection
- Attribute selectors: `"[data-id='123']"`
- Form elements: `"input[type='submit']"`
- Partial matches: `"[class*='btn']"`

---

## Common Errors

| Error | Fix |
|-------|-----|
| `Element not found` | Re-run `floyd_analyze_page`, use different selector |
| `timeout` | Increase wait time, check if element exists |
| `proxy timeout` | Open Floyd side panel in Chrome |
| `Extension context invalidated` | Run `floyd_reload` |

---

## Proxy Mode (External Terminals)

If NOT inside Floyd's side panel:

```bash
source "/path/to/extension/floyd-tools.sh"
# Commands work the same, but side panel must be open
```

---

## Raw Tool Access

```bash
# Direct tool call with JSON args
floyd_call analyze_page '{"include_css":true}'

# Any tool from the extension
floyd_call <tool_name> '{"arg1":"value1"}'
```
