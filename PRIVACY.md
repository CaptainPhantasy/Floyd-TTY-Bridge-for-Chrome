# Privacy Policy

**Floyd's Labs TTY Bridge** is a local-only browser extension. Here is what it does and does not do with your data.

## Data Collection

This extension **does not collect, transmit, or store any user data** on external servers operated by Floyd's Labs.

## What Stays Local

| Data | Storage | Scope |
|------|---------|-------|
| Gemini API key | `chrome.storage.local` | Browser profile only |
| Extension settings | `chrome.storage.local` | Browser profile only |
| Session checkpoints | `chrome.storage.local` | Browser profile only |
| Terminal history | In-memory (side panel) | Lost on panel close |
| Agent scratchpad | In-memory (service worker) | Lost on worker restart |

## Third-Party Services

If you configure a Gemini API key, the extension connects to **Google's Gemini API** (`generativelanguage.googleapis.com`) for:
- Gemini Live audio/video sessions
- Tool-use conversations

Data sent to Google is governed by [Google's API Terms of Service](https://developers.google.com/terms) and [Privacy Policy](https://policies.google.com/privacy). No data is sent to Google unless you explicitly start a Gemini Live session.

## Network Activity

- **Native messaging**: Local IPC only (stdin/stdout between Chrome and `native_host.py`). No network.
- **Knowledge base queries**: If configured, queries are sent to a knowledge base URL you specify. No default external endpoint.
- **Page analysis**: All DOM analysis, accessibility checks, and screenshot capture happen locally in the browser.

## Permissions Rationale

See [SECURITY.md](SECURITY.md) for a full breakdown of why each permission is required.

## Contact

Questions about this policy: contact the project maintainer or open an issue on the project repository.
