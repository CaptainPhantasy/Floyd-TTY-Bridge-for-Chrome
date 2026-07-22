# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 5.0.x   | Yes       |
| < 5.0   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in Floyd's Labs TTY Bridge, please report it responsibly:

1. **Do NOT open a public GitHub issue** for security vulnerabilities.
2. Email: **security@floydslabs.com** (or contact the maintainer directly).
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Security Architecture

### Trust Boundaries

Floyd's TTY Bridge operates across three trust boundaries:

```
Browser (Chrome)  <-->  Native Host (Python)  <-->  Shell (PTY)
   [sandboxed]           [user-level]              [user-level]
```

- **Chrome extension** runs in Chrome's extension sandbox with MV3 restrictions.
- **Native messaging host** runs as the logged-in user via Chrome's native messaging protocol.
- **PTY shell** inherits the user's full shell environment.

### Permissions

This extension requires broad permissions because it provides full browser automation to AI agents. Each permission is required:

| Permission | Why |
|------------|-----|
| `nativeMessaging` | Core bridge to PTY shell |
| `tabs` | Tab management and navigation |
| `debugger` | Chrome DevTools Protocol for network monitoring and advanced inspection |
| `sidePanel` | Terminal UI |
| `scripting` | Content script injection for page analysis |
| `activeTab` | Current tab interaction |
| `storage` | Settings and API key persistence |
| `downloads` | File download capability |
| `offscreen` | Audio processing for Gemini Live |
| `notifications` | Agent status alerts |
| `webNavigation` | Page load tracking |
| `declarativeNetRequestWithHostAccess` | Network rule management |
| `<all_urls>` | Page analysis on any site |

### API Key Handling

- The Gemini API key is stored in `chrome.storage.local` and **never leaves the browser profile**.
- The key is **never transmitted** except to Google's Gemini API endpoints.
- The key is **never logged** or included in error reports.
- **Important**: Ensure your `.gitignore` blocks secret files. Never commit API keys to version control.

### Shell Execution

The `execute_local_shell` tool runs commands via the native host with:
- A 30-second execution timeout
- Process group isolation (`os.setsid`)
- Automatic cleanup via ProcessSupervisor

**This tool has no command allowlist by design** — it exists to give agents full shell access. Restrict access to the extension itself if this is a concern in your environment.

## Known Limitations

- The native host runs with the user's full permissions (no sandboxing beyond process groups).
- Extension permissions are broad by design for full browser automation.
- There is no authentication layer between the extension and native host beyond Chrome's `allowed_origins` check in the native messaging manifest.

## Security Best Practices for Users

1. **Do not share your extension build** with untrusted parties — it includes native messaging access.
2. **Keep your Gemini API key private** — set it via the side panel UI, never in source files.
3. **Review the native messaging manifest** at `/Library/Google/Chrome/NativeMessagingHosts/com.floyd.tty.json` to ensure it points to the correct native host binary.
4. **Monitor for zombie processes** — if the bridge disconnects unexpectedly, check for orphaned `native_host.py` processes.
